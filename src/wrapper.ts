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
import {GoogleAuth, JWT} from 'google-auth-library';
import {clouddebugger_v2, google} from 'googleapis';
import * as util from 'util';
import * as types from './index';

const cloudDebugger = google.clouddebugger('v2').debugger;
const cloudProfiler = google.cloudprofiler('v2').projects;

export class Wrapper {
  private googleAuth = new GoogleAuth();
  private waitToken: types.WaitToken = '';
  private auth?: JWT;
  private projectId?: types.ProjectId;
  debuggeeId?: types.DebuggeeId;

  private isDebuggee(schemaDebuggee: clouddebugger_v2.Schema$Debuggee):
      schemaDebuggee is types.Debuggee {
    const debuggee = schemaDebuggee as types.Debuggee;
    return typeof debuggee.id === 'string' && debuggee.labels &&
        typeof debuggee.labels.projectid === 'string' &&
        typeof debuggee.labels.version === 'string';
  }

  private isDebuggeeList(debuggeeList: clouddebugger_v2.Schema$Debuggee[]):
      debuggeeList is types.Debuggee[] {
    for (const debuggee of debuggeeList) {
      if (!this.isDebuggee(debuggee)) {
        return false;
      }
    }
    return true;
  }

  private isBreakpoint(breakpointRequest:
                           types.BreakpointRequest|
                       clouddebugger_v2.Schema$Breakpoint):
      breakpointRequest is types.Breakpoint {
    const breakpoint = breakpointRequest as types.Breakpoint;
    return typeof breakpoint.id === 'string' && breakpoint.location &&
        typeof breakpoint.location.path === 'string' &&
        typeof breakpoint.location.line === 'number';
  }

  private isPendingBreakpointList(breakpointList:
                                      clouddebugger_v2.Schema$Breakpoint[]):
      breakpointList is types.Breakpoint[] {
    for (const breakpoint of breakpointList) {
      // A pending breakpoint list should not have any captured snapshots.
      if (!this.isBreakpoint(breakpoint) || breakpoint.isFinalState) {
        return false;
      }
    }
    return true;
  }

  async authorize(keyFilename?: types.SourcePath) {
    const credential = await this.googleAuth.getClient({
      keyFilename,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    if (!credential.projectId) {
      throw new Error('The given keyFile must contain the project ID.');
    }
    this.projectId = credential.projectId;
    this.auth = credential as JWT;
  }

  getProjectId(): types.ProjectId {
    if (!this.projectId) {
      throw new Error('You must select a project before continuing.');
    }
    return this.projectId;
  }

  async debuggeesList(): Promise<types.Debuggee[]> {
    if (!this.auth) {
      throw new Error('You must select a project before continuing.');
    }
    const request: types.DebuggeesListRequest = {
      project: this.projectId,
      auth: this.auth,
    };
    const response = await cloudDebugger.debuggees.list(request);
    if (response.data.debuggees === undefined) {
      return [];
    } else if (this.isDebuggeeList(response.data.debuggees)) {
      return response.data.debuggees;
    } else {
      throw new Error(
          'The debuggees.list response from Stackdriver Debug ' +
          'contains an element that is not a debuggee: ' +
          util.inspect(response.data, {depth: null}));
    }
  }

  async debuggeesBreakpointsDelete(breakpointId: types.BreakpointId) {
    if (!this.auth) {
      throw new Error('You must select a project before continuing.');
    }
    if (!this.debuggeeId) {
      throw new Error('You must select a debuggee before continuing.');
    }
    const request: types.DebuggeesBreakpointsDeleteRequest = {
      debuggeeId: this.debuggeeId,
      breakpointId,
      auth: this.auth,
    };
    const response = await cloudDebugger.debuggees.breakpoints.delete(request);
  }

  async debuggeesBreakpointsGet(breakpointId: types.BreakpointId):
      Promise<types.Breakpoint> {
    if (!this.auth) {
      throw new Error('You must select a project before continuing.');
    }
    if (!this.debuggeeId) {
      throw new Error('You must select a debuggee before continuing.');
    }
    const request: types.DebuggeesBreakpointsGetRequest = {
      debuggeeId: this.debuggeeId,
      breakpointId,
      auth: this.auth,
    };
    const response = await cloudDebugger.debuggees.breakpoints.get(request);
    if (!response.data.breakpoint ||
        !this.isBreakpoint(response.data.breakpoint)) {
      throw new Error(
          'The debuggees.breakpoints.get response from Stackdriver Debug is ' +
          `missing a property: ${util.inspect(response.data, {depth: null})}`);
    }
    return response.data.breakpoint;
  }

  async debuggeesBreakpointsList(wait: boolean): Promise<types.Breakpoint[]> {
    if (!this.auth) {
      throw new Error('You must select a project before continuing.');
    }
    if (!this.debuggeeId) {
      throw new Error('You must select a debuggee before continuing.');
    }
    const request: types.DebuggeesBreakpointsListRequest = {
      debuggeeId: this.debuggeeId,
      waitToken: wait ? this.waitToken : '',
      auth: this.auth,
    };
    const response = await cloudDebugger.debuggees.breakpoints.list(request);
    if (!response.data.nextWaitToken) {
      throw new Error(
          'The debuggees.breakpoints.list response from Stackdriver Debug ' +
          'should have the nextWaitToken property, but it returned this: ' +
          util.inspect(response.data, {depth: null}));
    }
    this.waitToken = response.data.nextWaitToken;
    if (response.data.breakpoints === undefined) {
      return [];
    } else if (this.isPendingBreakpointList(response.data.breakpoints)) {
      return response.data.breakpoints;
    } else {
      throw new Error(
          'The debuggees.breakpoints.list response from Stackdriver Debug ' +
          'contains an element that is not a pending breakpoint: ' +
          util.inspect(response.data.breakpoints, {depth: null}));
    }
  }

  async debuggeesBreakpointsSet(breakpoint: types.BreakpointRequest):
      Promise<types.Breakpoint> {
    if (!this.auth) {
      throw new Error('You must select a project before continuing.');
    }
    if (!this.debuggeeId) {
      throw new Error('You must select a debuggee before continuing.');
    }
    const request: types.DebuggeesBreakpointsSetRequest = {
      debuggeeId: this.debuggeeId,
      requestBody: breakpoint,
      auth: this.auth,
    };
    const response = await cloudDebugger.debuggees.breakpoints.set(request);
    if (!response.data.breakpoint ||
        !this.isBreakpoint(response.data.breakpoint)) {
      throw new Error(
          'The debuggees.breakpoints.set response from Stackdriver Debug ' +
          `missing a property: ${util.inspect(response.data, {depth: null})}`);
    }
    return response.data.breakpoint;
  }

  async profilesCreate() {
    if (!this.auth || !this.projectId) {
      throw new Error('You must select a project before continuing.');
    }
    const request: types.ProfilesCreateRequest = {
      parent: 'eyqs-stackdriver-test',
      requestBody: {
        deployment: {
          labels: ['nodejs'],
          projectId: this.projectId,
          target: this.projectId,
        },
        profileType: [],
      },
      auth: this.auth,
    };
    const response = await cloudProfiler.profiles.create(request);
    console.log(response);
  }
}
