"""Reviewed v6/1 -> v6/2 -> v6/3, owned loopback-only customer demo. Synthetic Auth/PostgREST protocol adapter,
REAL Next frontend/API and REAL PostgreSQL RPC/RLS. No hosted credentials or DSN.
No dependency installation. --serve-seconds retains the disposable demo briefly.
"""
import argparse
import base64
import hashlib
import hmac
import http.server
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import uuid

import managed_customer_notes_release as release
from postgres_harness import LocalDocker

ROOT=release.ROOT
spec=importlib.util.spec_from_file_location('pilot_tests',ROOT/'scripts/test-managed-customer-notes.py')
tests=importlib.util.module_from_spec(spec);spec.loader.exec_module(tests)
base=tests.base
USERS={'owner@local.invalid':base.OWNER,'manager@local.invalid':base.MANAGER,
       'employee@local.invalid':base.EMPLOYEE,'other@local.invalid':base.FOREIGN}
PASSWORD='synthetic-local-only'


def b64(value):return base64.urlsafe_b64encode(value).decode().rstrip('=')
def free_port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]


class Adapter(http.server.ThreadingHTTPServer):
    def __init__(self,pg):
        super().__init__(('127.0.0.1',0),Handler)
        self.pg=pg;self.secret=os.urandom(32);self.origin='';self.calls=0

    def session(self,email):
        user={'id':USERS[email],'aud':'authenticated','role':'authenticated','email':email,
              'email_confirmed_at':'2026-01-01T00:00:00Z','created_at':'2026-01-01T00:00:00Z',
              'app_metadata':{'provider':'email'},'user_metadata':{},'identities':[]}
        now=int(time.time());body=b64(json.dumps({'sub':user['id'],'aud':'authenticated','role':'authenticated','iat':now,'exp':now+3600,'email':email}).encode())
        unsigned=b64(b'{"alg":"HS256","typ":"JWT"}')+'.'+body
        token=unsigned+'.'+b64(hmac.new(self.secret,unsigned.encode(),hashlib.sha256).digest())
        return {'access_token':token,'refresh_token':b64(os.urandom(32)),'token_type':'bearer','expires_in':3600,'expires_at':now+3600,'user':user}

    def identify(self,header):
        try:
            token=header.removeprefix('Bearer ');a,b,c=token.split('.')
            if not hmac.compare_digest(c,b64(hmac.new(self.secret,(a+'.'+b).encode(),hashlib.sha256).digest())):return None
            claim=json.loads(base64.urlsafe_b64decode(b+'='*(-len(b)%4)))
            if claim['exp']<=time.time() or claim['sub'] not in USERS.values():return None
            return claim['sub']
        except (ValueError,KeyError):return None


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*_):pass  # Never log auth headers, cookies, SQL or request bodies.
    def reply(self,value,status=200):
        raw=json.dumps(value).encode();self.send_response(status)
        self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store')
        if self.headers.get('origin')==self.server.origin:self.send_header('Access-Control-Allow-Origin',self.server.origin)
        self.send_header('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,accept-profile,content-profile')
        self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS');self.send_header('Content-Length',str(len(raw)))
        self.end_headers();self.wfile.write(raw)
    def do_OPTIONS(self):self.reply({})
    def do_GET(self):self.dispatch()
    def do_POST(self):self.dispatch()
    def dispatch(self):
        self.server.calls+=1
        try:
            url=urllib.parse.urlsplit(self.path);query=urllib.parse.parse_qs(url.query)
            length=int(self.headers.get('content-length','0'))
            if length>8192:return self.reply({'code':'INVALID_REQUEST'},413)
            body=json.loads(self.rfile.read(length)) if length else {}
            if url.path=='/auth/v1/token':
                if body.get('email') not in USERS or body.get('password')!=PASSWORD:return self.reply({'code':'invalid_credentials','message':'Synthetic login refused'},400)
                return self.reply(self.server.session(body['email']))
            actor=self.server.identify(self.headers.get('authorization',''))
            if not actor:return self.reply({'code':'AUTH_REQUIRED','message':'Synthetic session required'},401)
            if url.path=='/auth/v1/user':return self.reply(self.server.session(next(e for e,u in USERS.items() if u==actor))['user'])
            if url.path=='/auth/v1/logout':return self.reply({})
            sql=None
            if url.path=='/rest/v1/tenant_memberships':
                tenant=query.get('tenant_id',[''])[0].removeprefix('eq.')
                condition=' AND tenant_id='+base.q(tenant)+'::uuid' if tenant else ''
                sql="SELECT COALESCE(jsonb_agg(jsonb_build_object('tenant_id',tenant_id,'role',role,'is_active',is_active)),'[]') FROM public.tenant_memberships WHERE user_id="+base.q(actor)+" AND is_active"+condition
            elif url.path=='/rest/v1/tenant_data' and self.command=='GET':
                tenant=query.get('tenant_id',[''])[0].removeprefix('eq.')
                if not tenant:return self.reply({'code':'INVALID_REQUEST'},400)
                sql="SELECT COALESCE(jsonb_agg(jsonb_build_object('payload',payload)),'[]') FROM public.tenant_data WHERE tenant_id="+base.q(tenant)+"::uuid AND data_key='all_data'"
            elif url.path=='/rest/v1/tenants':
                sql="SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'slug',slug,'company_name',company_name,'status',status,'plan_name',plan_name,'allowed_modules',allowed_modules)),'[]') FROM public.tenants"
            elif url.path=='/rest/v1/rpc/hh_customer_read' and self.command=='POST':
                sql='SELECT public.hh_customer_read('+base.q(body['p_tenant'])+'::uuid,'+(base.q(body['p_customer'])+'::uuid' if body.get('p_customer') else 'NULL')+')'
            elif url.path=='/rest/v1/rpc/hh_customer_write' and self.command=='POST':
                sql='SELECT public.hh_customer_write('+','.join([base.q(body['p_tenant'])+'::uuid',base.q(body['p_operation'])+'::uuid',base.q(json.dumps(body['p_data']))+'::jsonb',base.q(body['p_customer'])+'::uuid' if body.get('p_customer') else 'NULL',str(int(body['p_expected'])) if body.get('p_expected') is not None else 'NULL',base.q(body['p_reason']) if body.get('p_reason') else 'NULL'])+')'
            if sql is None:return self.reply({'code':'LOCAL_ADAPTER_ROUTE_NOT_SUPPORTED'},404)
            result=base.actor(self.server.pg,sql,actor)
            if result.returncode:
                code=base.code(result);match=re.search(r'ERROR:\s+[A-Z0-9]{5}:\s*([A-Z_]+)\s*(?:\n|$)',result.stderr)
                return self.reply({'code':code,'message':match[1] if match else 'COMMAND_REFUSED'},403 if code=='42501' else 400)
            value=json.loads(result.stdout.strip().splitlines()[-1])
            if 'application/vnd.pgrst.object+json' in self.headers.get('accept',''):
                if not value:return self.reply({'code':'PGRST116','details':'0 rows','message':'No rows'},406)
                value=value[0]
            self.reply(value)
        except Exception:self.reply({'code':'LOCAL_ADAPTER_FAILURE'},500)


def safe_environment(api):
    env=dict(os.environ)
    for key in list(env):
        if any(x in key.upper() for x in ('SUPABASE','NEXT_PUBLIC','VERCEL','HANDYHUB','PASSWORD','TOKEN','SECRET','DATABASE_URL','DIRECT_URL','PGPASSWORD','NODE_OPTIONS','API_KEY')):env.pop(key,None)
    env.update(NEXT_PUBLIC_APP_ENV='local',NEXT_PUBLIC_SUPABASE_URL=api,NEXT_PUBLIC_SUPABASE_ANON_KEY='sb_publishable_SYNTHETIC_LOCAL_PILOT',HANDYHUB_CUSTOMER_PERSISTENCE_ENABLED='true',NEXT_TELEMETRY_DISABLED='1')
    return env


def copy_app(directory):
    working_files={
        'src/app/page.tsx','src/app/clientes/cadastro-inteligente/page.tsx',
        'src/lib/customers/registration.ts','src/proxy.ts','tests/customer-registration.test.mjs'
    }
    for name in subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0'):
        if not name or Path(name).name.startswith('.env'):continue
        dest=directory/name;dest.parent.mkdir(parents=True,exist_ok=True)
        if name in working_files:shutil.copyfile(ROOT/name,dest)
        else:dest.write_bytes(subprocess.check_output(['git','show','HEAD:'+name],cwd=ROOT))
    for name in ['src/app/api/customers/route.ts','src/lib/customers/persistence-client.ts','src/components/customers/CustomerModalForm.tsx',
                 'tests/customer-modal.test.mjs','tests/customer-persistence-route.test.mjs']:
        dest=directory/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/name,dest)
    shutil.copytree(ROOT/'node_modules',directory/'node_modules',ignore=shutil.ignore_patterns('.cache'))


def http(url,body=None,headers=None,method=None):
    request=urllib.request.Request(url,json.dumps(body).encode() if body is not None else None,headers or {},method=method)
    try:
        with urllib.request.urlopen(request,timeout=90) as response:return response.status,json.loads(response.read())
    except urllib.error.HTTPError as e:return e.code,json.loads(e.read() or b'{}')


def flow(server,origin):
    def session(email):
        value=server.session(email)
        return 'sb-127-auth-token=base64-'+b64(json.dumps(value).encode())
    owner={'Cookie':session('owner@local.invalid'),'Origin':origin,'Content-Type':'application/json'}
    candidate={'fullName':'Cliente Demonstração Fictício','cpf':'52998224725','birthDate':'1990-04-12','phone':'+5511987654321','notes':'Observação fictícia de criação.'}
    body={'tenantId':base.A,'operationId':str(uuid.uuid4()),'draft':candidate}
    status,created=http(origin+'/api/customers',body,owner);assert status==201,('create',status,created)
    status,got=http(origin+'/api/customers?tenantId='+base.A+'&customerId='+created['id'],headers=owner)
    assert status==200 and got['draft']==candidate,('read',status,got.get('code'))
    edited={**candidate,'fullName':'Cliente Fictício Editado','phone':'+5511987654322','notes':'Observação fictícia editada.'}
    update={'tenantId':base.A,'operationId':str(uuid.uuid4()),'customerId':created['id'],'expectedVersion':1,'draft':edited}
    status,result=http(origin+'/api/customers',update,owner,'PATCH');assert status==200 and result['version']==2,('update',status,result)
    status,got=http(origin+'/api/customers?tenantId='+base.A+'&customerId='+created['id'],headers=owner);assert status==200 and got['draft']==edited
    assert http(origin+'/api/customers',update,owner,'PATCH')[1]==result,'Retry duplicated operation'
    assert http(origin+'/api/customers',{**update,'operationId':str(uuid.uuid4())},owner,'PATCH')[0]==409,'Stale version accepted'
    assert http(origin+'/api/customers',{**body,'operationId':str(uuid.uuid4())},owner)[0]==409,'CPF duplicate accepted'
    for email in ['manager@local.invalid','employee@local.invalid','other@local.invalid']:
        headers={**owner,'Cookie':session(email)}
        assert http(origin+'/api/customers?tenantId='+base.A,headers=headers)[0]==403,'Foreign/unauthorized list exposed'
        assert http(origin+'/api/customers',body,headers)[0]==403,'Unauthorized writer accepted'
    assert http(origin+'/api/customers?tenantId='+base.A)[0]==401
    print('HTTP_END_TO_END=PASS create/read/edit and notes persisted; retry, stale version, CPF, profiles and tenants checked. REVIEWED V6/3; LOCAL ONLY.',flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--serve-seconds',type=int,default=0);parser.add_argument('--port',type=int,default=0);args=parser.parse_args()
    tests.old.CLIENT=LocalDocker(executable=str(base.CLI));base.CLIENT=tests.old.CLIENT;before=base.inventory()
    pg=None;server=None;child=None;log=None
    directory=Path(tempfile.mkdtemp(prefix='handyhub-customer-functional-'))
    # IDs only, outside Git: make any resource difference diagnosable, never ignored.
    (directory/'docker-inventory-before.json').write_text(json.dumps(before,sort_keys=True),encoding='utf-8')
    try:
        pg=tests.fixture('customer-notes-functional');base.good(pg,tests.ACK+release.installation_sql());tests.old.activate(pg)
        server=Adapter(pg);threading.Thread(target=server.serve_forever,daemon=True).start()
        port=args.port or free_port();origin='http://127.0.0.1:'+str(port);server.origin=origin
        app=directory/'app';app.mkdir();copy_app(app)
        closed=safe_environment('http://127.0.0.1:'+str(server.server_port)+'/')
        closed.pop('HANDYHUB_CUSTOMER_PERSISTENCE_ENABLED',None);closed['NODE_ENV']='production'
        with (directory/'production-build.log').open('w',encoding='utf-8') as build_log:
            built=subprocess.run([shutil.which('node'),str(app/'node_modules/next/dist/bin/next'),'build'],cwd=app,env=closed,stdout=build_log,stderr=subprocess.STDOUT)
        if built.returncode:raise RuntimeError('Full Next production build failed; see isolated production-build.log')
        print('FULL_PRODUCTION_BUILD=PASS (flag absent, synthetic loopback configuration)',flush=True)
        log=(directory/'closed-server.log').open('w',encoding='utf-8')
        child=subprocess.Popen([shutil.which('node'),str(app/'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',str(port)],cwd=app,env=closed,stdout=log,stderr=subprocess.STDOUT)
        deadline=time.monotonic()+30;calls=server.calls
        while True:
            try:
                if http(origin+'/api/customers?tenantId='+base.A)[0]==404:break
            except Exception:pass
            if child.poll() is not None or time.monotonic()>deadline:raise RuntimeError('Closed production server unavailable')
            time.sleep(.2)
        for method in ['GET','POST','PATCH','POST']:
            headers={'Content-Type':'application/json','Origin':origin,'HANDYHUB_CUSTOMER_PERSISTENCE_ENABLED':'true','Cookie':'HANDYHUB_CUSTOMER_PERSISTENCE_ENABLED=true'}
            assert http(origin+'/api/customers?enabled=true',{} if method!='GET' else None,headers,method)[0]==404
        assert server.calls==calls,'Closed feature contacted local Auth/RPC adapter'
        print('FLAG_CLOSED_HTTP=4/4 PASS; zero Auth/PostgREST adapter calls.',flush=True)
        subprocess.run(['taskkill','/PID',str(child.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);child.wait(timeout=15);child=None;log.close()
        log=(directory/'next.log').open('w',encoding='utf-8')
        child=subprocess.Popen([shutil.which('node'),str(app/'node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',str(port)],cwd=app,env=safe_environment('http://127.0.0.1:'+str(server.server_port)+'/'),stdout=log,stderr=subprocess.STDOUT)
        deadline=time.monotonic()+120
        while time.monotonic()<deadline:
            if child.poll() is not None:raise RuntimeError('Next failed; see isolated next.log')
            try:
                with urllib.request.urlopen(origin+'/',timeout=2) as response:
                    if response.status==200:break
            except Exception:time.sleep(.3)
        else:raise TimeoutError('Next startup timed out')
        flow(server,origin)
        print(json.dumps({'url':origin+'/','log_directory':str(directory),'container_id':pg.container_id,'synthetic_login':'owner@local.invalid','synthetic_password':PASSWORD,'auth':'local protocol adapter, not hosted GoTrue/PostgREST'}),flush=True)
        deadline=time.monotonic()+args.serve_seconds
        while time.monotonic()<deadline and not (directory/'STOP').exists():time.sleep(.5)
    finally:
        if child and child.poll() is None:
            # Kill only this launcher's process tree. Never enumerate unrelated node processes.
            subprocess.run(['taskkill','/PID',str(child.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            child.wait(timeout=15)
        if log:log.close()
        if server:server.shutdown();server.server_close()
        if pg:pg.close()
        tests.old.CLIENT.assert_same_server()
        after=base.inventory()
        (directory/'docker-inventory-after.json').write_text(json.dumps(after,sort_keys=True),encoding='utf-8')
        equal=before==after;print('DOCKER_INVENTORY_PRESERVED='+str(equal),flush=True)
        if not equal:
            changes={key:{'removed':sorted(set(before[key])-set(after[key])),
                          'added':sorted(set(after[key])-set(before[key]))}
                     for key in ('containers','networks','volumes','images') if before[key]!=after[key]}
            print('DOCKER_INVENTORY_DIFFERENCES='+json.dumps(changes),flush=True)
        if not equal:raise RuntimeError('Unexpected local Docker resource difference; no global cleanup')


if __name__=='__main__':main()
