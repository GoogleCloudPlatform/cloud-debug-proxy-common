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
const STACKDRIVER_URL = 'https://clouddebugger.googleapis.com';
const API_URL = '/v2/debugger';

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
const INVALID_DEBUGGEE = {
  id: 'test-invalid-debuggee',
};

const INVALID_KEYFILE_ERROR_REGEXP_LIST = [
  /SyntaxError: Unexpected token } in JSON at position 98/,
  /The given keyFile must contain the project ID\./,
  /Error: The incoming JSON object does not contain a private_key field/,
  /Error: The incoming JSON object does not contain a client_email field/,
];
const INVALID_STATUS_CODE_LIST = [301, 302, 400, 401, 403, 404, 500, 503, 504];
const EMPTY_DEBUGGEE = {};
const INVALID_LIST_DEBUGGEE_LIST =
    [{debuggees: null}, {debuggees: VALID_DEBUGGEE}];
const LIST_INVALID_DEBUGGEE_LIST = [
  {debuggees: 'not-a-list'},
  {debuggees: [EMPTY_DEBUGGEE]},
  {debuggees: [VALID_DEBUGGEE, INVALID_DEBUGGEE]},
];

nock.disableNetConnect();

describe('wrapper.ts', () => {
  let savedEnv: NodeJS.ProcessEnv;
  before(() => {
    savedEnv = process.env;
  });
  after(() => {
    process.env = savedEnv;
  });

  describe('authorize', () => {
    describe('Application Default Credentials', () => {
      beforeEach(() => {
        process.env = {};
      });

      it('should fail if no credentials are given', async () => {
        const wrapper = new Wrapper();
        await assertRejects(
            wrapper.authorize(),
            /application default credentials: Could not load the default/);
      });

      it('should support Application Default Credentials', async () => {
        const wrapper = new Wrapper();
        process.env.GOOGLE_APPLICATION_CREDENTIALS =
            './test/fixtures/application_default_credentials.json';
        await wrapper.authorize();
      });

      it('should not cache the supported credentials', async () => {
        const wrapper = new Wrapper();
        await assertRejects(
            wrapper.authorize(),
            /application default credentials: Could not load the default/);
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

      // TODO: it should fail if file not found; wait until issue fixed
      // https://github.com/google/google-auth-library-nodejs/issues/395

      it('should support keyFile credentials', async () => {
        const wrapper = new Wrapper();
        await wrapper.authorize('./test/fixtures/keyfile.json');
      });

      it('should not cache the supported credentials', async () => {
        const wrapper = new Wrapper();
        await assertRejects(
            wrapper.authorize('./test/fixtures/invalid_keyfile_1.json'),
            /The given keyFile must contain the project ID\./);
      });

      INVALID_KEYFILE_ERROR_REGEXP_LIST.forEach((regexp, i) => {
        it(`should not support invalid keyfile ${i}`, async () => {
          const wrapper = new Wrapper();
          await assertRejects(
              wrapper.authorize(`./test/fixtures/invalid_keyfile_${i}.json`),
              regexp);
        });
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
    beforeEach(() => {
      process.env = {};
    });

    it('should fail if not authorized', () => {
      const wrapper = new Wrapper();
      return assertRejects(
          wrapper.debuggeesList(),
          /You must select a project before continuing\./);
    });

    INVALID_STATUS_CODE_LIST.forEach((httpCode) => {
      it(`should throw on invalid HTTP status code ${httpCode}`, async () => {
        const wrapper = new Wrapper();
        await wrapper.authorize('./test/fixtures/keyfile.json');
        nocks.oauth2();
        nock(STACKDRIVER_URL)
            .get(API_URL + '/debuggees')
            .query(true)
            .reply(httpCode, {debuggees: [VALID_DEBUGGEE]});
        await assertRejects(wrapper.debuggeesList());
      });
    });

    INVALID_LIST_DEBUGGEE_LIST.forEach((response, i) => {
      it(`should throw on invalid list ${i}`, async () => {
        const wrapper = new Wrapper();
        await wrapper.authorize('./test/fixtures/keyfile.json');
        nocks.oauth2();
        nock(STACKDRIVER_URL)
            .get(API_URL + '/debuggees')
            .query(true)
            .reply(200, response);
        await assertRejects(
            wrapper.debuggeesList(), /TypeError: debuggeeList is not iterable/);
      });
    });

    LIST_INVALID_DEBUGGEE_LIST.forEach((response, i) => {
      it(`should throw on list of invalid debuggees ${i}`, async () => {
        const wrapper = new Wrapper();
        await wrapper.authorize('./test/fixtures/keyfile.json');
        nocks.oauth2();
        nock(STACKDRIVER_URL)
            .get(API_URL + '/debuggees')
            .query(true)
            .reply(200, response);
        await assertRejects(
            wrapper.debuggeesList(),
            /debuggees.list.* contains an element that is not a debuggee:/);
      });
    });

    it('should return a list of debuggees', async () => {
      const wrapper = new Wrapper();
      await wrapper.authorize('./test/fixtures/keyfile.json');
      nocks.oauth2();
      nock(STACKDRIVER_URL).get(API_URL + '/debuggees').query(true).reply(200, {
        debuggees: [VALID_DEBUGGEE, INACTIVE_DEBUGGEE, DISABLED_DEBUGGEE]
      });
      const debuggeeList: types.Debuggee[] = await wrapper.debuggeesList();
      assert.deepStrictEqual(
          debuggeeList, [VALID_DEBUGGEE, INACTIVE_DEBUGGEE, DISABLED_DEBUGGEE]);
    });

    it('should return an empty list if there are no debuggees', async () => {
      const wrapper = new Wrapper();
      await wrapper.authorize('./test/fixtures/keyfile.json');
      nocks.oauth2();
      nock(STACKDRIVER_URL)
          .get(API_URL + '/debuggees')
          .query(true)
          .reply(200, {});
      const debuggeeList: types.Debuggee[] = await wrapper.debuggeesList();
      assert.deepStrictEqual(debuggeeList, []);
    });
  });
});
