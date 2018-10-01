/**
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import * as assert from 'assert';
import * as nock from 'nock';
import * as util from 'util';
import * as types from '../src/index';
import {Wrapper} from '../src/wrapper';
import * as nocks from './nocks';

const assertRejects = require('assert-rejects');

const ADC_PROJECT_ID = 'adc-project-id';
const KEYFILE_PROJECT_ID = 'keyfile-project-id';
const DEBUGGER_ID = 'test-debugger-id';
const DEBUGGEE_ID = 'test-debuggee-id';
const WAIT_TOKEN = 'wait-token';
const STACKDRIVER_URL = 'https://clouddebugger.googleapis.com';
const API_URL = '/v2/debugger';

const INVALID_KEYFILE_ERROR_REGEXP_LIST = [
  /SyntaxError: Unexpected token } in JSON at position 98/,
  /The project ID cannot be determined\./,
  /Error: The incoming JSON object does not contain a private_key field/,
  /Error: The incoming JSON object does not contain a client_email field/,
];
const INVALID_STATUS_CODE_LIST = [301, 302, 400, 401, 403, 404, 500, 503, 504];

const VALID_DEBUGGEE: types.Debuggee = {
  id: 'test-valid-debuggee',
  description: 'This is a description of a valid debuggee.',
  labels: {
    projectid: KEYFILE_PROJECT_ID,
    version: 'test-valid-debuggee-version',
  },
};
const INACTIVE_DEBUGGEE: types.Debuggee = {
  id: 'test-inactive-debuggee',
  description: 'This is a description of an inactive debuggee.',
  isInactive: true,
  labels: {
    projectid: KEYFILE_PROJECT_ID,
    version: 'test-inactive-debuggee-version',
  },
};
const DISABLED_DEBUGGEE: types.Debuggee = {
  id: 'test-disabled-debuggee',
  description: 'This is a description of a disabled debuggee.',
  isDisabled: true,
  labels: {
    projectid: KEYFILE_PROJECT_ID,
    version: 'test-disabled-debuggee-version',
  },
};
const INVALID_LIST_DEBUGGEE_LIST =
    [{debuggees: null}, {debuggees: 42}, {debuggees: VALID_DEBUGGEE}];
const INVALID_DEBUGGEE_LIST = [
  {},
  {id: 'test-invalid-debuggee', labels: 'label-string'},
  {id: 42, labels: {projectid: 'projectid', version: 'gcp:12345'}},
  {id: 'test-invalid-debuggee', labels: {version: 'gcp:12345'}},
  {id: 'test-invalid-debuggee', labels: {projectid: 'projectid'}},
  {id: 'test-invalid-debuggee', labels: {projectid: 7, version: 'gcp:12345'}},
  {id: 'test-invalid-debuggee', labels: {projectid: 'projectid', version: 3}},
];

const VALID_BREAKPOINT: types.Breakpoint = {
  id: 'test-valid-breakpoint',
  location: {
    path: 'test-valid-breakpoint-path',
    line: 42,
  },
};
const INVALID_LIST_BREAKPOINT_LIST = [
  {nextWaitToken: WAIT_TOKEN, breakpoints: null},
  {nextWaitToken: WAIT_TOKEN, breakpoints: 42},
  {nextWaitToken: WAIT_TOKEN, breakpoints: VALID_BREAKPOINT},
];
const INVALID_BREAKPOINT_LIST = [
  {},
  {id: 'test-invalid-breakpoint', location: 'location-string'},
  {id: 42, location: {path: 'source-path', line: 57}},
  {id: 'test-invalid-breakpoint', location: {line: 57}},
  {id: 'test-invalid-breakpoint', location: {path: 'source-path'}},
  {id: 'test-invalid-breakpoint', location: {path: 1337, line: 57}},
  {id: 'test-invalid-breakpoint', location: {path: 'source-path', line: '57'}},
];
const CAPTURED_SNAPSHOT_LIST = [
  {
    id: 'test-captured-snapshot',
    isFinalState: true,
    location: {path: 'source-path', line: 57}
  },
];

nock.disableNetConnect();

describe('wrapper.ts', () => {
  let savedEnv: NodeJS.ProcessEnv;
  before(() => {
    savedEnv = process.env;
  });
  after(() => {
    process.env = savedEnv;
    assert(nock.isDone());
  });

  describe('authorize', () => {
    describe('Application Default Credentials', () => {
      beforeEach(() => {
        process.env = {};
      });

      it('should fail if no credentials are given', async () => {
        const wrapper = new Wrapper();
        nocks.notGCE();
        await assertRejects(
            wrapper.authorize(),
            /Error: Could not load the default credentials\./);
      });

      it('should support Application Default Credentials', async () => {
        const wrapper = new Wrapper();
        process.env.GOOGLE_APPLICATION_CREDENTIALS =
            './test/fixtures/application_default_credentials.json';
        await wrapper.authorize();
      });

      it('should not cache the supported credentials', async () => {
        const wrapper = new Wrapper();
        nocks.notGCE();
        await assertRejects(
            wrapper.authorize(),
            /Error: Could not load the default credentials\./);
      });

      it('should support Application Default Credentials, pass pid',
         async () => {
           const wrapper = new Wrapper();
           process.env.GOOGLE_APPLICATION_CREDENTIALS =
               './test/fixtures/application_default_credentials_no_project.json';
           await wrapper.authorize(undefined, 'some-pid');
           assert.equal(wrapper.getProjectId(), 'some-pid');
         });

      it('should support Application Default Credentials, pid from env',
         async () => {
           const wrapper = new Wrapper();
           process.env.GOOGLE_APPLICATION_CREDENTIALS =
               './test/fixtures/application_default_credentials_no_project.json';
           process.env.GOOGLE_CLOUD_PROJECT = 'some-pid';
           await wrapper.authorize();
           assert.equal(wrapper.getProjectId(), 'some-pid');
         });

      INVALID_KEYFILE_ERROR_REGEXP_LIST.forEach((regexp, i) => {
        it(`should not support invalid keyfile ${i}`, async () => {
          const wrapper = new Wrapper();
          process.env.GOOGLE_APPLICATION_CREDENTIALS =
              `./test/fixtures/invalid_keyfile_${i}.json`,
          await assertRejects(wrapper.authorize(), regexp);
        });
      });

      it('should not cache the invalid credentials', async () => {
        const wrapper = new Wrapper();
        process.env.GOOGLE_APPLICATION_CREDENTIALS =
            './test/fixtures/application_default_credentials.json';
        await wrapper.authorize();
      });
    });

    describe('keyFile credentials', () => {
      beforeEach(() => {
        process.env = {};
      });

      it('should fail if file not found', async () => {
        const wrapper = new Wrapper();
        await assertRejects(
            wrapper.authorize('DOES_NOT_EXIST'),
            /ENOENT: no such file or directory, open.*DOES_NOT_EXIST/);
      });

      it('should support keyFile credentials', async () => {
        const wrapper = new Wrapper();
        await wrapper.authorize('./test/fixtures/keyfile.json');
      });

      it('should not cache the supported credentials', async () => {
        const wrapper = new Wrapper();
        await assertRejects(
            wrapper.authorize('./test/fixtures/invalid_keyfile_1.json'),
            /The project ID cannot be determined\./);
      });

      INVALID_KEYFILE_ERROR_REGEXP_LIST.forEach((regexp, i) => {
        it(`should not support invalid keyfile ${i}`, async () => {
          const wrapper = new Wrapper();
          await assertRejects(
              wrapper.authorize(`./test/fixtures/invalid_keyfile_${i}.json`),
              regexp);
        });
      });

      it('should support keyFile credentials, pass pid', async () => {
        const wrapper = new Wrapper();
        await wrapper.authorize('./test/fixtures/keyfile.json', 'some-pid');
        assert.equal(wrapper.getProjectId(), 'some-pid');
      });

      it('should support keyFile credentials, pid from env', async () => {
        const wrapper = new Wrapper();
        process.env.GOOGLE_CLOUD_PROJECT = 'some-pid';
        await wrapper.authorize('./test/fixtures/invalid_keyfile_1.json');
        assert.equal(wrapper.getProjectId(), 'some-pid');
      });

      it('should not cache the invalid credentials', async () => {
        const wrapper = new Wrapper();
        await wrapper.authorize('./test/fixtures/keyfile.json');
        assert.strictEqual(wrapper.getProjectId(), KEYFILE_PROJECT_ID);
      });
    });
  });

  describe('getProjectId', () => {
    beforeEach(() => {
      process.env = {};
    });

    it('should fail if not authorized', () => {
      const wrapper = new Wrapper();
      assert.throws(
          wrapper.getProjectId.bind(wrapper),
          /You must select a project before continuing\./);
    });

    it('should support Application Default Credentials', async () => {
      const wrapper = new Wrapper();
      process.env.GOOGLE_APPLICATION_CREDENTIALS =
          './test/fixtures/application_default_credentials.json';
      await wrapper.authorize();
      assert.equal(wrapper.getProjectId(), ADC_PROJECT_ID);
    });

    it('should support keyfile credentials', async () => {
      const wrapper = new Wrapper();
      await wrapper.authorize('./test/fixtures/keyfile.json');
      assert.equal(wrapper.getProjectId(), KEYFILE_PROJECT_ID);
    });

    it('should not cache the supported credentials', () => {
      const wrapper = new Wrapper();
      assert.throws(
          wrapper.getProjectId.bind(wrapper),
          /You must select a project before continuing\./);
    });
  });

  describe('debuggeesList', () => {
    const NOCK_URL = `${API_URL}/debuggees`;

    beforeEach(() => {
      process.env = {};
    });

    async function initialize(): Promise<Wrapper> {
      const wrapper = new Wrapper();
      await wrapper.authorize('./test/fixtures/keyfile.json');
      nocks.oauth2();
      return wrapper;
    }

    it('should fail if not authorized', async () => {
      const wrapper = new Wrapper();
      await assertRejects(
          wrapper.debuggeesList(),
          /You must select a project before continuing\./);
    });

    INVALID_STATUS_CODE_LIST.forEach((httpCode) => {
      it(`should throw on invalid HTTP status code ${httpCode}`, async () => {
        const wrapper = await initialize();
        nock(STACKDRIVER_URL)
            .get(NOCK_URL)
            .query({project: KEYFILE_PROJECT_ID})
            .reply(httpCode, {debuggees: [VALID_DEBUGGEE]});
        // 30x: Request failed with status code 30x
        // 40x, 50x: Error: [object Object]
        await assertRejects(
            wrapper.debuggeesList(),
            /(?:Request failed with status)|(?:Error: \[object Object\])/);
      });
    });

    INVALID_LIST_DEBUGGEE_LIST.forEach((response, i) => {
      it(`should throw on invalid list ${i}`, async () => {
        const wrapper = await initialize();
        nock(STACKDRIVER_URL)
            .get(NOCK_URL)
            .query({project: KEYFILE_PROJECT_ID})
            .reply(200, response);
        // Node 6: Cannot read property 'Symbol(Symbol.iterator)' of null
        // Node 6: debuggeeList[Symbol.iterator] is not a function
        // Node 8+: debuggeeList is not iterable
        await assertRejects(wrapper.debuggeesList(), /TypeError:/);
      });
    });

    INVALID_DEBUGGEE_LIST.forEach((debuggee, i) => {
      it(`should throw on invalid debuggee ${i}`, async () => {
        const wrapper = await initialize();
        nock(STACKDRIVER_URL)
            .get(NOCK_URL)
            .query({project: KEYFILE_PROJECT_ID})
            .reply(200, {debuggees: [debuggee]});
        await assertRejects(
            wrapper.debuggeesList(),
            /debuggees\.list.* contains an element that is not a debuggee:/);
      });
    });

    it('should throw on list of invalid debuggees', async () => {
      const wrapper = await initialize();
      nock(STACKDRIVER_URL)
          .get(NOCK_URL)
          .query({project: KEYFILE_PROJECT_ID})
          .reply(200, {debuggees: INVALID_DEBUGGEE_LIST});
      await assertRejects(
          wrapper.debuggeesList(),
          /debuggees\.list.* contains an element that is not a debuggee:/);
    });

    it('should return a valid debuggee', async () => {
      const wrapper = await initialize();
      nock(STACKDRIVER_URL)
          .get(NOCK_URL)
          .query({project: KEYFILE_PROJECT_ID})
          .reply(200, {
            debuggees: [VALID_DEBUGGEE],
          });
      assert.deepStrictEqual(await wrapper.debuggeesList(), [VALID_DEBUGGEE]);
    });

    it('should return a list of debuggees', async () => {
      const wrapper = await initialize();
      nock(STACKDRIVER_URL)
          .get(NOCK_URL)
          .query({project: KEYFILE_PROJECT_ID})
          .reply(200, {
            debuggees: [VALID_DEBUGGEE, INACTIVE_DEBUGGEE, DISABLED_DEBUGGEE],
          });
      assert.deepStrictEqual(
          await wrapper.debuggeesList(),
          [VALID_DEBUGGEE, INACTIVE_DEBUGGEE, DISABLED_DEBUGGEE]);
    });

    it('should return an empty list if there are no debuggees', async () => {
      const wrapper = await initialize();
      nock(STACKDRIVER_URL)
          .get(NOCK_URL)
          .query({project: KEYFILE_PROJECT_ID})
          .reply(200, {});
      assert.deepStrictEqual(await wrapper.debuggeesList(), []);
    });
  });

  describe('debuggeesBreakpointsList', () => {
    const NOCK_URL = `${API_URL}/debuggees/${DEBUGGEE_ID}/breakpoints`;

    beforeEach(() => {
      process.env = {};
    });

    async function initialize(): Promise<Wrapper> {
      const wrapper = new Wrapper();
      await wrapper.authorize('./test/fixtures/keyfile.json');
      wrapper.debuggeeId = DEBUGGEE_ID;
      nocks.oauth2();
      return wrapper;
    }

    it('should fail if not authorized', async () => {
      const wrapper = new Wrapper();
      await Promise.all([
        assertRejects(
            wrapper.debuggeesBreakpointsList(false),
            /You must select a project before continuing\./),
        assertRejects(
            wrapper.debuggeesBreakpointsList(true),
            /You must select a project before continuing\./),
      ]);
    });

    it('should fail if no debuggee is set', async () => {
      const wrapper = new Wrapper();
      await wrapper.authorize('./test/fixtures/keyfile.json');
      await Promise.all([
        assertRejects(
            wrapper.debuggeesBreakpointsList(false),
            /You must select a debuggee before continuing\./),
        assertRejects(
            wrapper.debuggeesBreakpointsList(true),
            /You must select a debuggee before continuing\./),
      ]);
    });

    it('should fail if nextWaitToken is missing', async () => {
      const wrapper = await initialize();
      nock(STACKDRIVER_URL)
          .get(NOCK_URL)
          .twice()
          .query({waitToken: ''})
          .reply(200, {});
      await Promise.all([
        assertRejects(
            wrapper.debuggeesBreakpointsList(false),
            /breakpoints\.list.* should have the nextWaitToken property, but it/),
        assertRejects(
            wrapper.debuggeesBreakpointsList(true),
            /breakpoints\.list.* should have the nextWaitToken property, but it/),
      ]);
    });

    INVALID_STATUS_CODE_LIST.forEach((httpCode) => {
      it(`should throw on invalid HTTP status code ${httpCode}`, async () => {
        const wrapper = await initialize();
        nock(STACKDRIVER_URL)
            .get(NOCK_URL)
            .twice()
            .query({waitToken: ''})
            .reply(
                httpCode,
                {nextWaitToken: WAIT_TOKEN, breakpoints: [VALID_BREAKPOINT]});
        // 30x: Request failed with status code 30x
        // 40x, 50x: Error: [object Object]
        await Promise.all([
          assertRejects(
              wrapper.debuggeesBreakpointsList(true),
              /(?:Request failed with status)|(?:Error: \[object Object\])/),
          assertRejects(
              wrapper.debuggeesBreakpointsList(true),
              /(?:Request failed with status)|(?:Error: \[object Object\])/),
        ]);
      });
    });

    INVALID_LIST_BREAKPOINT_LIST.forEach((response, i) => {
      it(`should throw on invalid list ${i}`, async () => {
        const wrapper = await initialize();
        nock(STACKDRIVER_URL)
            .get(NOCK_URL)
            .query({waitToken: ''})
            .reply(200, response);
        // Node 6: Cannot read property 'Symbol(Symbol.iterator)' of null
        // Node 6: breakpointList[Symbol.iterator] is not a function
        // Node 8+: breakpointList is not iterable
        await assertRejects(wrapper.debuggeesBreakpointsList(false), /TypeErr/);
        nock(STACKDRIVER_URL)
            .get(NOCK_URL)
            .query({waitToken: WAIT_TOKEN})
            .reply(200, response);
        await assertRejects(wrapper.debuggeesBreakpointsList(true), /TypeErr/);
      });
    });

    INVALID_BREAKPOINT_LIST.forEach((breakpoint, i) => {
      it(`should throw on invalid breakpoint ${i}`, async () => {
        const wrapper = await initialize();
        nock(STACKDRIVER_URL).get(NOCK_URL).query({waitToken: ''}).reply(200, {
          nextWaitToken: WAIT_TOKEN,
          breakpoints: [breakpoint],
        });
        await assertRejects(
            wrapper.debuggeesBreakpointsList(false),
            /breakpoints\.list.* an element that is not a pending breakpoint:/);
        nock(STACKDRIVER_URL)
            .get(NOCK_URL)
            .query({waitToken: WAIT_TOKEN})
            .reply(200, {nextWaitToken: WAIT_TOKEN, breakpoints: [breakpoint]});
        await assertRejects(
            wrapper.debuggeesBreakpointsList(true),
            /breakpoints\.list.* an element that is not a pending breakpoint:/);
      });
    });

    it('should throw on list of invalid breakpoints', async () => {
      const wrapper = await initialize();
      nock(STACKDRIVER_URL).get(NOCK_URL).query({waitToken: ''}).reply(200, {
        nextWaitToken: WAIT_TOKEN,
        breakpoints: INVALID_BREAKPOINT_LIST,
      });
      await assertRejects(
          wrapper.debuggeesBreakpointsList(false),
          /breakpoints\.list.* an element that is not a pending breakpoint:/);
      nock(STACKDRIVER_URL)
          .get(NOCK_URL)
          .query({waitToken: WAIT_TOKEN})
          .reply(200, {
            nextWaitToken: WAIT_TOKEN,
            breakpoints: INVALID_BREAKPOINT_LIST,
          });
      await assertRejects(
          wrapper.debuggeesBreakpointsList(true),
          /breakpoints\.list.* an element that is not a pending breakpoint:/);
    });

    CAPTURED_SNAPSHOT_LIST.forEach((snapshot, i) => {
      it(`should throw on captured snapshot ${i}`, async () => {
        const wrapper = await initialize();
        nock(STACKDRIVER_URL).get(NOCK_URL).query({waitToken: ''}).reply(200, {
          nextWaitToken: WAIT_TOKEN,
          breakpoints: [snapshot],
        });
        await assertRejects(
            wrapper.debuggeesBreakpointsList(false),
            /breakpoints\.list.* an element that is not a pending breakpoint:/);
        nock(STACKDRIVER_URL)
            .get(NOCK_URL)
            .query({waitToken: WAIT_TOKEN})
            .reply(200, {nextWaitToken: WAIT_TOKEN, breakpoints: [snapshot]});
        await assertRejects(
            wrapper.debuggeesBreakpointsList(true),
            /breakpoints\.list.* an element that is not a pending breakpoint:/);
      });
    });

    it('should throw on list of captured snapshots', async () => {
      const wrapper = await initialize();
      nock(STACKDRIVER_URL).get(NOCK_URL).query({waitToken: ''}).reply(200, {
        nextWaitToken: WAIT_TOKEN,
        breakpoints: CAPTURED_SNAPSHOT_LIST,
      });
      await assertRejects(
          wrapper.debuggeesBreakpointsList(false),
          /breakpoints\.list.* an element that is not a pending breakpoint:/);
      nock(STACKDRIVER_URL)
          .get(NOCK_URL)
          .query({waitToken: WAIT_TOKEN})
          .reply(
              200,
              {nextWaitToken: WAIT_TOKEN, breakpoints: CAPTURED_SNAPSHOT_LIST});
      await assertRejects(
          wrapper.debuggeesBreakpointsList(true),
          /breakpoints\.list.* an element that is not a pending breakpoint:/);
    });

    it('should return a valid breakpoint', async () => {
      const wrapper = await initialize();
      nock(STACKDRIVER_URL).get(NOCK_URL).query({waitToken: ''}).reply(200, {
        nextWaitToken: WAIT_TOKEN,
        breakpoints: [VALID_BREAKPOINT],
      });
      assert.deepStrictEqual(
          await wrapper.debuggeesBreakpointsList(false), [VALID_BREAKPOINT]);
      nock(STACKDRIVER_URL)
          .get(NOCK_URL)
          .query({waitToken: WAIT_TOKEN})
          .reply(200, {
            nextWaitToken: WAIT_TOKEN,
            breakpoints: [VALID_BREAKPOINT],
          });
      assert.deepStrictEqual(
          await wrapper.debuggeesBreakpointsList(true), [VALID_BREAKPOINT]);
    });

    it('should return a list of breakpoints', async () => {
      const wrapper = await initialize();
      nock(STACKDRIVER_URL).get(NOCK_URL).query({waitToken: ''}).reply(200, {
        nextWaitToken: WAIT_TOKEN,
        breakpoints: [VALID_BREAKPOINT, VALID_BREAKPOINT, VALID_BREAKPOINT],
      });
      assert.deepStrictEqual(
          await wrapper.debuggeesBreakpointsList(false),
          [VALID_BREAKPOINT, VALID_BREAKPOINT, VALID_BREAKPOINT]);
      nock(STACKDRIVER_URL)
          .get(NOCK_URL)
          .query({waitToken: WAIT_TOKEN})
          .reply(200, {
            nextWaitToken: WAIT_TOKEN,
            breakpoints: [VALID_BREAKPOINT, VALID_BREAKPOINT, VALID_BREAKPOINT],
          });
      assert.deepStrictEqual(
          await wrapper.debuggeesBreakpointsList(true),
          [VALID_BREAKPOINT, VALID_BREAKPOINT, VALID_BREAKPOINT]);
    });

    it('should return an empty list if there are no breakpoints', async () => {
      const wrapper = await initialize();
      nock(STACKDRIVER_URL).get(NOCK_URL).query({waitToken: ''}).reply(200, {
        nextWaitToken: WAIT_TOKEN,
      });
      assert.deepStrictEqual(await wrapper.debuggeesBreakpointsList(false), []);
      nock(STACKDRIVER_URL)
          .get(NOCK_URL)
          .query({waitToken: WAIT_TOKEN})
          .reply(200, {nextWaitToken: WAIT_TOKEN});
      assert.deepStrictEqual(await wrapper.debuggeesBreakpointsList(true), []);
    });

    it('should update waitToken after every call', async () => {
      const wrapper = await initialize();
      nock(STACKDRIVER_URL).get(NOCK_URL).query({waitToken: ''}).reply(200, {
        nextWaitToken: 'wait-token-1',
      });
      await wrapper.debuggeesBreakpointsList(true);
      nock(STACKDRIVER_URL)
          .get(NOCK_URL)
          .query({waitToken: 'wait-token-1'})
          .reply(200, {nextWaitToken: 'wait-token-2'});
      await wrapper.debuggeesBreakpointsList(true);
      nock(STACKDRIVER_URL).get(NOCK_URL).query({waitToken: ''}).reply(200, {
        nextWaitToken: 'wait-token-3',
      });
      await wrapper.debuggeesBreakpointsList(false);
      nock(STACKDRIVER_URL)
          .get(NOCK_URL)
          .query({waitToken: 'wait-token-3'})
          .reply(200, {nextWaitToken: 'wait-token-4'});
      await wrapper.debuggeesBreakpointsList(true);
    });
  });
});
