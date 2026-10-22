"""AS-02: catálogo completo e paginação confinada, sem Canvas/AWS reais."""
import copy
import io
import json
import os
import pathlib
import sys
import unittest
import urllib.error
import urllib.request
import urllib.response
from email.message import Message
from unittest.mock import patch

import boto3
from moto import mock_aws

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "backend"))

from canvas import CanvasClient, CanvasError, course_catalog
from canvas_sync import run
from portal import save_catalog
from repository import Repository
from test_canvas import BASE, FakeCanvas, _Response, course
from test_portal import MemoryRepository

COURSE = '4436'
API = BASE + '/api/v1'
MODULES = f'/courses/{COURSE}/modules?include[]=items&per_page=100'
ITEMS = f'/courses/{COURSE}/modules/7/items?per_page=100'


def item(id=81, assignment=11, **extra):
    return {'id': id, 'module_id': 7, 'type': 'Assignment', 'content_id': assignment,
            'html_url': f'{BASE}/courses/{COURSE}/modules/items/{id}', **extra}


def module(**extra):
    return {'id': 7, 'name': 'Módulo de teste', 'published': True, 'items_count': 1,
            'items_url': API + f'/courses/{COURSE}/modules/7/items', 'items': [item()], **extra}


class Pages:
    def __init__(self, pages, fallback=None):
        self.pages, self.fallback, self.calls = pages, fallback, []
    def __call__(self, request, timeout=None):
        url = request.full_url
        self.calls.append(url)
        if url not in self.pages:
            if self.fallback: return self.fallback(request, timeout)
            raise AssertionError('URL não prevista na fixture')
        result = self.pages[url]
        if isinstance(result, Exception): raise result
        data, link = result
        return _Response(data, link)
    def client(self): return CanvasClient(BASE, 'dummy-not-secret', opener=self)


class CatalogCompletenessTests(unittest.TestCase):
    def test_inline_complete_counts_all_types_without_fallback_and_keeps_first_assignment(self):
        data = module(items_count=4, items=[item(), item(82, 11), item(83, 12, type='Page'), item(84, 13, published=False)])
        pages = Pages({API + MODULES: ([data], '')})
        result = course_catalog(pages.client(), COURSE)
        self.assertEqual(result['items'], {'11': {'module': 0, 'url': item()['html_url']}})
        self.assertEqual(pages.calls, [API + MODULES])

    def test_omitted_null_and_partial_inline_use_only_needed_module_endpoint(self):
        for incomplete in ['omitted', None, []]:
            with self.subTest(incomplete=incomplete):
                first = module()
                if incomplete == 'omitted': first.pop('items')
                else: first['items'] = incomplete
                pages = Pages({API + MODULES: ([first], ''), API + ITEMS: ([item()], '')})
                result = course_catalog(pages.client(), COURSE)
                self.assertEqual(result['items'], {'11': {'module': 0, 'url': item()['html_url']}})
                self.assertEqual(pages.calls, [API + MODULES, API + ITEMS])

    def test_fallback_follows_all_pages_even_when_first_page_empty_and_next_is_opaque(self):
        second = API + f'/courses/{COURSE}/modules/7/items?cursor=opaque'
        third = API + f'/courses/{COURSE}/modules/7/items?cursor=last'
        pages = Pages({API + MODULES: ([module(items_count=2, items=None)], ''),
                       API + ITEMS: ([], f'<{second}>; rel="next"'),
                       second: ([item(80, type='Page')], f'<{third}>; rel="next"'), third: ([item()], '')})
        self.assertEqual(course_catalog(pages.client(), COURSE)['items']['11']['url'], item()['html_url'])
        self.assertEqual(pages.calls, [API + MODULES, API + ITEMS, second, third])

    def test_legitimate_empty_course_and_empty_module_can_remove_old_entries(self):
        for modules in [[], [module(items_count=0, items=[])], [module(published=False)]]:
            with self.subTest(modules=modules):
                pages = Pages({API + MODULES: (modules, '')})
                repo = MemoryRepository(); repo.put('CATALOG#4436', 'METADATA', {'courseId': COURSE, 'modules':['antigo'], 'items':{'1': {}}})
                candidate = course_catalog(pages.client(), COURSE)
                self.assertTrue(save_catalog(repo, candidate))
                self.assertEqual(repo.get('CATALOG#4436', 'METADATA')['items'], {})

    def test_invalid_or_incomplete_universe_is_rejected_before_assignment_filter(self):
        invalid = [module(items_count=2, items=[item(), item()]), module(items_count=0),
                   module(items_count=-1), module(items_count=True), module(items_count='1'),
                   module(items_count=1, items={'id':81}), module(items=[None]),
                   module(items=[item(id='bad')]), module(items=[item(module_id=8)]),
                   module(id='../8'), module(id=True), module(course_id=99), module(course_id=99,published=False),
                   module(items_count=1, items=[item(type='Page'), item(82)])]
        for value in invalid:
            with self.subTest(value=value):
                pages = Pages({API + MODULES: ([value], '')})
                with self.assertRaises(CanvasError): course_catalog(pages.client(), COURSE)

    def test_invalid_items_url_is_never_requested_and_does_not_return_candidate(self):
        bad = ['https://other.example.test/api/v1/courses/4436/modules/7/items',
               API + '/courses/99/modules/7/items', API + '/courses/4436/modules/8/items',
               API + '/courses/4436/modules/7/items/../items', BASE + '/not-an-api']
        for url in bad:
            with self.subTest(url=url):
                pages = Pages({API + MODULES: ([module(items=None, items_url=url)], '')})
                with self.assertRaises(CanvasError): course_catalog(pages.client(), COURSE)
                self.assertEqual(pages.calls, [API + MODULES])

    def test_fallback_exhausted_but_count_mismatch_or_duplicate_nonassignment_is_error(self):
        for items, count in [([], 1), ([item()], 2), ([item(), item(82)], 1),
                             ([item(80,type='Page'),item(80,type='Page')], 2)]:
            with self.subTest(items=items, count=count):
                pages = Pages({API + MODULES: ([module(items=None,items_count=count)], ''), API + ITEMS:(items,'')})
                with self.assertRaises(CanvasError): course_catalog(pages.client(), COURSE)

    def test_missing_items_url_uses_constructed_route_from_validated_ids(self):
        data=module(items=None);data.pop('items_url')
        pages=Pages({API + MODULES:([data],''),API + ITEMS:([item()],'')})
        self.assertIn('11',course_catalog(pages.client(),COURSE)['items'])
        self.assertEqual(pages.calls,[API + MODULES,API + ITEMS])

    def test_fallback_failure_preserves_catalog_but_grades_continue_and_proof_is_not_succeeded(self):
        for code in [403,500,'network']:
            with self.subTest(http=code):
                payload=course();fallback=FakeCanvas({COURSE:payload})
                pages=Pages({API + MODULES:([module(items=None)],''),
                    API + ITEMS:urllib.error.URLError('synthetic') if code=='network' else
                    urllib.error.HTTPError(API + ITEMS,code,'synthetic',{},None)},fallback=fallback)
                repo=MemoryRepository();repo.put('COHORT#SYNTH01','METADATA',{'code':'SYNTH01','current':None,'autoSync':True,'canvasCourseId':COURSE})
                old={'courseId':COURSE,'modules':['anterior'],'items':{'11':{'module':0,'url':item()['html_url']}}}
                repo.put('CATALOG#4436','METADATA',old)
                event={'source':'portal.scheduler','type':'canvas-sync','scheduledFor':'2026-10-21T21:00:00Z','executionId':'fixture','attemptNumber':1}
                with patch('canvas.time.sleep'):
                    results,failures=run(repo,pages.client(),event=event,clock=lambda:'2026-10-21T21:00:01Z')
                self.assertEqual(repo.get('CATALOG#4436','METADATA'),old)
                self.assertTrue(repo.get('COHORT#SYNTH01','METADATA')['current'])
                proof=repo.get('COHORT#SYNTH01','SYNC_RUN#2026-10-21T21:00:00Z')
                self.assertEqual(proof['status'],'failed');self.assertEqual(proof['stages']['grades'],'published')
                self.assertTrue(failures);self.assertEqual(results,{'SYNTH01':'failed'})

    def test_module_list_and_item_pages_are_both_complete_before_returning_catalog(self):
        next_modules=API + f'/courses/{COURSE}/modules?page=2'
        next_items=API + f'/courses/{COURSE}/modules/8/items?cursor=next'
        second=module(id=8,name='Segundo',items=None,items_count=2,
                      items_url=API + f'/courses/{COURSE}/modules/8/items')
        route=API + f'/courses/{COURSE}/modules/8/items?per_page=100'
        pages=Pages({API + MODULES:([module()],f'<{next_modules}>; rel="next"'),
                     next_modules:([second],''), route:([item(82,12,module_id=8)],f'<{next_items}>; rel="next"'),
                     next_items:([item(83,type='Page',module_id=8)],'')})
        result=course_catalog(pages.client(),COURSE)
        self.assertEqual(result['modules'],['Módulo de teste','Segundo'])
        self.assertEqual(result['items']['12']['module'],1)
        self.assertEqual(len(pages.calls),4)

    def test_later_page_denial_never_replaces_a_valid_persisted_catalog(self):
        next_items=API + f'/courses/{COURSE}/modules/7/items?cursor=denied'
        pages=Pages({API + MODULES:([module(items=None,items_count=2)],''),
                     API + ITEMS:([item()],f'<{next_items}>; rel="next"'),
                     next_items:urllib.error.HTTPError(next_items,403,'synthetic',{},None)})
        repo=MemoryRepository()
        old={'courseId':COURSE,'modules':['anterior'],'items':{'11':{'module':0,'url':item()['html_url']}}}
        repo.put('CATALOG#4436','METADATA',old)
        with self.assertRaises(CanvasError):
            save_catalog(repo,course_catalog(pages.client(),COURSE))
        self.assertEqual(repo.get('CATALOG#4436','METADATA'),old)
        self.assertEqual(len(pages.calls),3)

    def test_module_and_assignment_identity_shape_is_validated(self):
        missing_count=module();missing_count.pop('items_count')
        for data in [[None],[module(),module()],[missing_count],[module(name=' ')],
                     [module(items=[item(content_id=True)])],
                     [module(items=[item(html_url=item()['html_url']+'?wrong=1')])],
                     [module(items=[item(html_url=item()['html_url'].replace('/81','/999'))])]]:
            with self.subTest(data=data):
                with self.assertRaises(CanvasError):
                    course_catalog(Pages({API + MODULES:(data,'')}).client(),COURSE)

    def test_two_cohorts_reuse_one_complete_course_catalog_and_preserve_academic_values(self):
        payload=course();fallback=FakeCanvas({COURSE:payload},page_size=100)
        pages=Pages({API + MODULES:([module(items=None,items_count=2)],''),
                     API + ITEMS:([item(),item(82,12)],'')},fallback=fallback)
        repo=MemoryRepository()
        for code in ['SYNTH01','SYNTH02']:
            repo.put('COHORT#'+code,'METADATA',{'code':code,'current':None,'autoSync':True,'canvasCourseId':COURSE})
        results,failures=run(repo,pages.client(),clock=lambda:'2026-10-21T21:00:01Z')
        self.assertFalse(failures);self.assertEqual(set(results),{'SYNTH01','SYNTH02'})
        self.assertEqual(pages.calls.count(API + MODULES),1)
        self.assertEqual(pages.calls.count(API + ITEMS),1)
        snapshots=[]
        for code in results:
            publication=repo.get('COHORT#'+code,'PUB#'+repo.get('COHORT#'+code,'METADATA')['current'])
            snapshots.append(repo.snapshot(publication['snapshot']))
        self.assertEqual(snapshots[0]['activities'],snapshots[1]['activities'])
        self.assertEqual(snapshots[0]['students'],snapshots[1]['students'])


@mock_aws
class CatalogPersistenceTests(unittest.TestCase):
    """Repository boto3 real sob Moto: nenhum endpoint Canvas ou AWS de produção."""
    def setUp(self):
        env=patch.dict(os.environ,{'AWS_DEFAULT_REGION':'us-east-1','TABLE_NAME':'catalog-fixture',
                                  'IMPORTS_BUCKET':'catalog-fixture-imports'})
        env.start();self.addCleanup(env.stop)
        boto3.client('dynamodb').create_table(TableName='catalog-fixture',
            KeySchema=[{'AttributeName':'PK','KeyType':'HASH'},{'AttributeName':'SK','KeyType':'RANGE'}],
            AttributeDefinitions=[{'AttributeName':'PK','AttributeType':'S'},{'AttributeName':'SK','AttributeType':'S'}],
            BillingMode='PAY_PER_REQUEST')
        boto3.client('s3').create_bucket(Bucket='catalog-fixture-imports')
        self.repo=Repository()
        self.repo.put('COHORT#SYNTH01','METADATA',{'code':'SYNTH01','current':None,'autoSync':True,'canvasCourseId':COURSE})

    def test_failure_preserves_same_course_catalog_and_successful_empty_candidate_removes_it(self):
        old={'courseId':COURSE,'modules':['anterior'],'items':{'11':{'module':0,'url':item()['html_url']}}}
        self.repo.put('CATALOG#4436','METADATA',old)
        fallback=FakeCanvas({COURSE:course()},page_size=100)
        next_items=API+f'/courses/{COURSE}/modules/7/items?cursor=denied'
        pages=Pages({API+MODULES:([module(items=None,items_count=2)],''),
                     API+ITEMS:([item()],f'<{next_items}>; rel="next"'),
                     next_items:urllib.error.HTTPError(next_items,403,'fixture',{},None)},fallback=fallback)
        event={'source':'portal.scheduler','type':'canvas-sync','scheduledFor':'2026-10-21T21:00:00Z','executionId':'fixture','attemptNumber':1}
        results,failures=run(self.repo,pages.client(),event=event,clock=lambda:'2026-10-21T21:00:01Z')
        self.assertEqual(self.repo.get('CATALOG#4436','METADATA'),old)
        self.assertEqual(results,{'SYNTH01':'failed'});self.assertTrue(failures)
        self.assertEqual(self.repo.get('COHORT#SYNTH01','SYNC_RUN#2026-10-21T21:00:00Z')['stages']['grades'],'published')
        # Completo e realmente vazio é diferente de falha/inconclusivo: remove entradas antigas.
        empty=course_catalog(Pages({API+MODULES:([module(items_count=0,items=[])],'')}).client(),COURSE)
        self.assertTrue(save_catalog(self.repo,empty))
        self.assertEqual(self.repo.get('CATALOG#4436','METADATA')['items'],{})
        self.assertEqual(self.repo.get('CATALOG#4436','METADATA')['modules'],[])


class ConfinedPaginationTests(unittest.TestCase):
    def test_next_never_crosses_origin_course_or_resource_or_downgrades_tls(self):
        targets=['https://evil.example.test/api/v1/courses/4436/modules?page=2',
                 BASE + '/api/v1/courses/99/modules?page=2',BASE + '/api/v1/courses/4436/users?page=2',
                 'http://canvas.example.test/api/v1/courses/4436/modules?page=2',
                 'https://user:pass@canvas.example.test/api/v1/courses/4436/modules?page=2',
                 BASE + '/api/v1/courses/4436/modules/../modules?page=2']
        for target in targets:
            with self.subTest(target=target):
                pages=Pages({API + MODULES:([],f'<{target}>; rel="next"'),target:([],'')})
                with self.assertRaises(CanvasError) as error:pages.client().get_all(MODULES)
                self.assertNotIn('dummy-not-secret',str(error.exception));self.assertEqual(pages.calls,[API + MODULES])

    def test_cycle_is_rejected_before_requesting_same_page_again(self):
        # Se o antigo código tentar repetir, a fixture retorna uma última página para o RED terminar.
        calls=[]
        def opener(request,timeout=None):
            calls.append(request.full_url)
            return _Response([],f'<{request.full_url}>; rel="next"' if len(calls)==1 else '')
        with self.assertRaises(CanvasError):CanvasClient(BASE,'dummy',opener=opener).get_all(MODULES)
        self.assertEqual(len(calls),1)

    def test_pagination_rejects_nonlist_page_and_invalid_json(self):
        for bad in [{'error':'synthetic'},None,'not-json']:
            with self.subTest(bad=bad):
                def opener(request,timeout=None):
                    return _Response(bad,'') if bad!='not-json' else io.BytesIO(b'not-json')
                with self.assertRaises(CanvasError):CanvasClient(BASE,'dummy',opener=opener).get_all(MODULES)

    def test_lowercase_link_and_empty_page_next_still_follow_opaque_cursor(self):
        second=API + f'/courses/{COURSE}/modules?cursor=a%2Fb%3D&unknown=opaque'
        calls=[]
        def opener(request,timeout=None):
            calls.append(request.full_url)
            response=_Response([] if len(calls)==1 else [{'id':7}], '')
            response.headers={'link':f'<{second}>; rel="next"'} if len(calls)==1 else {}
            return response
        self.assertEqual(CanvasClient(BASE,'dummy',opener=opener).get_all(MODULES),[{'id':7}])
        self.assertEqual(calls,[API+MODULES,second])

    def test_opaque_cursor_named_next_is_not_mistaken_for_a_next_relation(self):
        pages=Pages({API+MODULES:([{'id':7}],f'<{API}/courses/4436/modules?cursor=next>; rel="current"')})
        self.assertEqual(pages.client().get_all(MODULES),[{'id':7}])
        self.assertEqual(pages.calls,[API+MODULES])

    def test_malformed_or_ambiguous_next_links_do_not_become_end_of_pagination(self):
        target=API+'/courses/4436/modules?cursor=second'
        for link in ['not-a-link; rel="next"',f'<{target}>; rel="next',
                     f'<{target}>; rel="next", <{target}>; rel="next"']:
            with self.subTest(link=link):
                pages=Pages({API+MODULES:([],link)})
                with self.assertRaises(CanvasError):pages.client().get_all(MODULES)
                self.assertEqual(pages.calls,[API+MODULES])

    def test_default_opener_refuses_foreign_redirect_before_sending_authorization(self):
        for target in ['https://other.example.test/api/v1/courses/4436/modules',
                       API+'/courses/99/modules',API+'/courses/4436/users']:
            with self.subTest(target=target):
                calls=[]
                class FixtureHttps(urllib.request.BaseHandler):
                    handler_order=0
                    def https_open(self,request):
                        calls.append((request.full_url,request.get_header('Authorization')))
                        headers=Message();headers['Location']=target
                        response=urllib.response.addinfourl(io.BytesIO(b''),headers,request.full_url,302)
                        response.msg='Found'
                        return response
                client=CanvasClient(BASE,'dummy-not-secret')
                client.opener.__self__.add_handler(FixtureHttps())
                with self.assertRaises(CanvasError) as error:client.get_all(MODULES)
                self.assertEqual(calls,[(API+MODULES,'Bearer dummy-not-secret')])
                self.assertNotIn('dummy-not-secret',str(error.exception))

    def test_default_opener_allows_same_resource_redirect_with_opaque_query(self):
        target=API+f'/courses/{COURSE}/modules?cursor=redirect'
        calls=[]
        class FixtureHttps(urllib.request.BaseHandler):
            handler_order=0
            def https_open(self,request):
                calls.append(request.full_url)
                headers=Message()
                if len(calls)==1:headers['Location']=target
                response=urllib.response.addinfourl(io.BytesIO(b'[]'),headers,request.full_url,302 if len(calls)==1 else 200)
                response.msg='Found' if len(calls)==1 else 'OK'
                return response
        client=CanvasClient(BASE,'dummy');client.opener.__self__.add_handler(FixtureHttps())
        self.assertEqual(client.get_all(MODULES),[])
        self.assertEqual(calls,[API+MODULES,target])


if __name__=='__main__': unittest.main()
