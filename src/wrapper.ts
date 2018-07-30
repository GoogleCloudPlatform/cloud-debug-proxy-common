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
        throw new Error(
            'This debuggee in the debuggees.list response is missing ' +
            `the debuggee ID: ${util.inspect(debuggee, {depth: null})}`);
      }
    }
    return true;
  }

  private isBreakpoint(breakpointRequest:
                           types.BreakpointRequest|
                       clouddebugger_v2.Schema$Breakpoint):
      breakpointRequest is types.Breakpoint {
    const breakpoint = breakpointRequest as types.Breakpoint;
    return (breakpoint.action === types.Action.CAPTURE ||
            breakpoint.action === types.Action.LOG) &&
        breakpoint.location && typeof breakpoint.location.path === 'string' &&
        typeof breakpoint.location.line === 'number' &&
        typeof breakpoint.id === 'string';
  }

  private isPendingBreakpointList(breakpointList:
                                      clouddebugger_v2.Schema$Breakpoint[]):
      breakpointList is types.PendingBreakpoint[] {
    for (const breakpoint of breakpointList) {
      if (!this.isBreakpoint(breakpoint)) {
        throw new Error(
            'This breakpoint in the debuggees.breakpoints.list response is ' +
            `missing a property: ${util.inspect(breakpoint, {depth: null})}`);
      }
      if (breakpoint.isFinalState) {
        throw new Error(
            'This breakpoint in the debuggees.breakpoints.list response ' +
            'should not be a captured snapshot, but it is: ' +
            util.inspect(breakpoint, {depth: null}));
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
    if (!response.data.debuggees) {
      throw new Error(
          'The debuggees.list response from Stackdriver Debug is missing ' +
          `the list of debuggees: ${util.inspect(response, {depth: null})}`);
    }
    if (!this.isDebuggeeList(response.data.debuggees)) {
      throw new Error('isDebuggeeList should throw on failure.');
    }
    return response.data.debuggees;
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

  async debuggeesBreakpointsList(wait: boolean):
      Promise<types.PendingBreakpoint[]> {
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
    if (!response.data.nextWaitToken || !response.data.breakpoints) {
      throw new Error(
          'The debuggees.breakpoints.list response from Stackdriver Debug ' +
          'should have the breakpoints and nextWaitToken properties, but ' +
          `it returned this: ${util.inspect(response.data, {depth: null})}`);
    }
    if (!this.isPendingBreakpointList(response.data.breakpoints)) {
      throw new Error('isPendingBreakpointList should throw on failure.');
    }
    return response.data.breakpoints;
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
}
