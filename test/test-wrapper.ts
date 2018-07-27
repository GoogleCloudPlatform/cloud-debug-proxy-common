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
import * as types from '../src/index';
import {Wrapper} from '../src/wrapper';

const assertRejects = require('assert-rejects');

const ADC_PROJECT_ID = 'adc-project-id';
const KEYFILE_PROJECT_ID = 'keyfile-project-id';
const NUM_INVALID_KEYFILES = 4;

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
        await assertRejects(wrapper.authorize());
      });

      it('should support Application Default Credentials', async () => {
        const wrapper = new Wrapper();
        process.env.GOOGLE_APPLICATION_CREDENTIALS =
            './test/fixtures/application_default_credentials.json';
        await wrapper.authorize();
      });

      it('should not cache the supported credentials', async () => {
        const wrapper = new Wrapper();
        await assertRejects(wrapper.authorize());
      });

      Array.from({length: NUM_INVALID_KEYFILES}).forEach((_, i) => {
        it(`should not support invalid keyfile ${i}`, async () => {
          const wrapper = new Wrapper();
          process.env.GOOGLE_APPLICATION_CREDENTIALS =
              `./test/fixtures/invalid_keyfile_${i}.json`,
          await assertRejects(wrapper.authorize());
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
            wrapper.authorize('./test/fixtures/invalid_keyfile_0.json'));
      });

      Array.from({length: NUM_INVALID_KEYFILES}).forEach((_, i) => {
        it(`should not support invalid keyfile ${i}`, async () => {
          const wrapper = new Wrapper();
          await assertRejects(
              wrapper.authorize(`./test/fixtures/invalid_keyfile_${i}.json`));
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
      assert.throws(wrapper.getProjectId);
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
      assert.throws(wrapper.getProjectId);
    });
  });
});
