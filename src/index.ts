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
import {EventEmitter} from 'events';
import {clouddebugger_v2} from 'googleapis';
import * as util from 'util';
import {Wrapper} from './wrapper';
import pLimit = require('p-limit');

export type OneIndexedLineNumber = number;
export type OneIndexedColumnNumber = number;
export type BreakpointId = string;
export type DebuggeeId = string;
export type DebuggerId = string;
export type Expression = string;
export type ProjectId = string;
export type SourcePath = string;
export type Timestamp = string;
export type WaitToken = string;

export interface Options {
  debuggerId: DebuggerId;
  sourceDirectory: SourcePath;
}

export type Variable = clouddebugger_v2.Schema$Variable;
export interface SourceLocation extends clouddebugger_v2.Schema$SourceLocation {
  path: SourcePath;
  line: OneIndexedLineNumber;
  column?: OneIndexedColumnNumber;
}
export interface StackFrame extends clouddebugger_v2.Schema$StackFrame {
  function: string;
  location: SourceLocation;
}

// A breakpoint is either a snapshot (`CAPTURE`) or a logpoint (`LOG`).
// A snapshot is either captured (`isFinalState === true`) or pending.
// https://cloud.google.com/debugger/api/reference/rest/v2/debugger.debuggees.breakpoints#Breakpoint
export enum Action {
  CAPTURE = 'CAPTURE',
  LOG = 'LOG',
}
export interface BreakpointRequest extends clouddebugger_v2.Schema$Breakpoint {
  action: Action;
  location: SourceLocation;
}
export interface Breakpoint extends clouddebugger_v2.Schema$Breakpoint {
  id: BreakpointId;
  location: SourceLocation;
}
export interface CapturedSnapshot extends Breakpoint {
  isFinalState: true;
  stackFrames: StackFrame[];
  variableTable: Variable[];
}
export interface Debuggee extends clouddebugger_v2.Schema$Debuggee {
  id: DebuggeeId;
  labels: {projectid: string; version: string};
}

export type DebuggeesListRequest =
    clouddebugger_v2.Params$Resource$Debugger$Debuggees$List;
export type DebuggeesBreakpointsDeleteRequest =
    clouddebugger_v2.Params$Resource$Debugger$Debuggees$Breakpoints$Delete;
export type DebuggeesBreakpointsGetRequest =
    clouddebugger_v2.Params$Resource$Debugger$Debuggees$Breakpoints$Get;
export type DebuggeesBreakpointsListRequest =
    clouddebugger_v2.Params$Resource$Debugger$Debuggees$Breakpoints$List;
export type DebuggeesBreakpointsSetRequest =
    clouddebugger_v2.Params$Resource$Debugger$Debuggees$Breakpoints$Set;

export interface DebuggeesListResponse {
  data: clouddebugger_v2.Schema$ListDebuggeesResponse;
}
export interface DebuggeesBreakpointsDeleteResponse {
  data: clouddebugger_v2.Schema$Empty;
}
export interface DebuggeesBreakpointsGetResponse {
  data: clouddebugger_v2.Schema$GetBreakpointResponse;
}
export interface DebuggeesBreakpointsListResponse {
  data: clouddebugger_v2.Schema$ListBreakpointsResponse;
}
export interface DebuggeesBreakpointsSetResponse {
  data: clouddebugger_v2.Schema$SetBreakpointResponse;
}

const hit = Symbol();
interface BreakpointInfo {
  [hit]: boolean;  // Set after a 'breakpointHit' event is emitted.
  breakpoint: Breakpoint;
}

const ABORTED_ERROR_CODE = 409;  // google.rpc.Code.ABORTED
const CONCURRENCY = 10;

/** @fires 'breakpointHit' as soon as any breakpoints are hit */
export interface DebugProxyInterface extends EventEmitter {
  /**
   * Updates the state of all pending breakpoints set by
   * this instance that implements `DebugProxyInterface`.
   *
   * @param block - true to block until breakpoint list changes, otherwise false
   * @fires 'breakpointHit' if any breakpoints were hit since their last checks
   */
  updatePendingBreakpoints(block: boolean): Promise<void>;
  /**
   * @returns project ID for the selected GCP project
   */
  getProjectId(): ProjectId;
  /**
   * Authorize the DebugProxy with GCP credentials and a GCP project ID.
   *
   * @param keyFilename Optional, path to the GCP credentials file. If unset
   *    application default credentials will be used.
   * @param projectId - Optional, the GCP project ID of the project to debug.
   *    If unset the project ID from the key file will be used or from the local
   *    environment (see https://github.com/google/google-auth-library-nodejs/)
   *    if the key file does not contain a project ID.
   */
  authorize(keyFilename?: SourcePath, projectId?: string): Promise<void>;
  /**
   * @returns debugger ID for the selected GCP debuggee
   */
  getDebuggerId(): DebuggerId;
  /**
   * @param debuggeeId - ID of the debuggee that is to be debugged
   */
  setDebuggeeId(debuggeeId: DebuggeeId): void;
  /**
   * @returns list of available debuggees for the selected project
   */
  getDebuggees(): Promise<Debuggee[]>;
  /**
   * Retrieves the breakpoint with the given ID.
   *
   * @param breakpointId - ID of the breakpoint to retrieve
   * @returns breakpoint with the given breakpoint ID
   * @throws if the breakpoint with the given ID was not set by this instance
   */
  getBreakpoint(breakpointId: BreakpointId): Promise<Breakpoint>;
  /**
   * Removes all breakpoints set by this instance
   * that implements `DebugProxyInterface`.
   */
  removeAllBreakpoints(): Promise<void>;
  /**
   * Removes all breakpoints in the given file that have not been hit.
   *
   * This function is used by UIs that do not send breakpoints incrementally;
   * that is, UIs that send all pending breakpoints together on every update.
   * These semantics can be implemented by clearing them before each update.
   *
   * @param path - path to the file in which breakpoints should be removed
   */
  removePendingBreakpointsForFile(path: SourcePath): Promise<void>;
  /**
   * Removes the breakpoint with the given ID.
   *
   * @param breakpointId - ID of the breakpoint to remove
   * @throws if the breakpoint with the given ID was not set by this instance
   */
  removeBreakpoint(breakpointId: BreakpointId): Promise<void>;
  /**
   * Sets a new pending breakpoint.
   *
   * @param breakpointRequest - breakpoint to set
   * @return breakpoint which was successfully set
   */
  setBreakpoint(breakpointRequest: BreakpointRequest): Promise<Breakpoint>;
  /**
   * Retrieves a list of all pending breakpoints or captured snapshots.
   *
   * @param captured - true to get a list of all captured snapshots,
   * false to get a list of all pending breakpoints
   * @returns list of breakpoints of the specified type
   */
  getBreakpointList(captured: boolean): Breakpoint[];
}

export class DebugProxy extends EventEmitter implements DebugProxyInterface {
  /* This `breakpointInfoMap` is the entire state of this `DebugProxy` instance,
   * and is only modified in the `set*` and `remove*` functions. A breakpoint is
   * in this map if and only if it was set by this `DebugProxy` instance, so no
   * other `DebugProxy` instances are able to interfere with these breakpoints.
   */
  private wrapper: Wrapper;
  private readonly breakpointInfoMap = new Map<BreakpointId, BreakpointInfo>();

  constructor(readonly options: Options) {
    super();
    this.wrapper = new Wrapper();
  }

  async updatePendingBreakpoints(block: boolean) {
    // `breakpointList` has all pending breakpoints on the debuggee.
    let breakpointList: Breakpoint[] = [];

    /* debuggees.breakpoints.list times out until the breakpoint list changes.
     * On timeout, it returns the error code google.rpc.Code.ABORTED, and
     * the request should be made again until the breakpoint list changes.
     */
    while (true) {
      try {
        breakpointList = await this.wrapper.debuggeesBreakpointsList(block);
        break;
      } catch (error) {
        if (!error.response || error.response.status !== ABORTED_ERROR_CODE) {
          throw error;
        }
      }
    }

    // `pendingBreakpointIdSet` has the IDs of all pending
    // breakpoints set by this instance of `DebugProxy`.
    const pendingBreakpointIdSet = new Set<BreakpointId>();
    breakpointList.forEach((breakpoint: Breakpoint) => {
      const id = breakpoint.id;
      const breakpointInfo = this.breakpointInfoMap.get(id);
      if (breakpointInfo) {
        assert.strictEqual(breakpointInfo[hit], false);
        assert.deepStrictEqual(breakpointInfo.breakpoint, breakpoint);
        pendingBreakpointIdSet.add(id);
      }
    });

    // A breakpoint in `breakpointInfoMap` but not in `pendingBreakpointIdSet`
    // could be hit since its last check, so check again and update its state.
    const possiblyHitLimit = pLimit(CONCURRENCY);
    const possiblyHitPromiseList: Array<Promise<Breakpoint>> = [];
    this.breakpointInfoMap.forEach((info: BreakpointInfo, id: BreakpointId) => {
      if (!pendingBreakpointIdSet.has(id)) {
        possiblyHitPromiseList.push(
            possiblyHitLimit(() => this.getBreakpoint(id)));
      }
    });

    // These breakpoints have either been hit or removed by someone else.
    let hitAny = false;
    const removedBreakpointLimit = pLimit(CONCURRENCY);
    const removedBreakpointPromiseList: Array<Promise<void>> = [];
    const possiblyHitBreakpointList = await Promise.all(possiblyHitPromiseList);
    possiblyHitBreakpointList.forEach((breakpoint: Breakpoint) => {
      if (breakpoint.isFinalState) {
        // These breakpoints all originally came from `breakpointInfoMap`.
        const breakpointInfo = this.breakpointInfoMap.get(breakpoint.id);
        if (!breakpointInfo) {
          throw new Error(
              `The breakpoint with ID ${breakpoint.id} ` +
              'was not set by this instance of `DebugProxy`.');
        }
        if (breakpointInfo[hit]) {
          assert.deepStrictEqual(breakpointInfo.breakpoint, breakpoint);
        } else {
          breakpointInfo[hit] = true;
          breakpointInfo.breakpoint = breakpoint;
          hitAny = true;
        }
      } else {
        removedBreakpointPromiseList.push(
            removedBreakpointLimit(() => this.removeBreakpoint(breakpoint.id)));
      }
    });

    if (hitAny) {
      this.emit('breakpointHit');
    }
    await Promise.all(removedBreakpointPromiseList);
  }

  getProjectId(): ProjectId {
    return this.wrapper.getProjectId();
  }

  async authorize(keyFilename?: SourcePath, projectId?: string) {
    await this.wrapper.authorize(keyFilename, projectId);
  }

  getDebuggerId(): DebuggerId {
    return this.options.debuggerId;
  }

  setDebuggeeId(debuggeeId: DebuggeeId) {
    this.wrapper.debuggeeId = debuggeeId;
  }

  async getDebuggees(): Promise<Debuggee[]> {
    return this.wrapper.debuggeesList();
  }

  getBreakpoint(breakpointId: BreakpointId): Promise<Breakpoint> {
    if (!this.breakpointInfoMap.has(breakpointId)) {
      throw new Error(
          `The breakpoint with ID ${breakpointId}, passed into ` +
          '`getBreakpoint`, was not set by this instance of `DebugProxy`.');
    }
    return this.wrapper.debuggeesBreakpointsGet(breakpointId);
  }

  async removeAllBreakpoints() {
    const limit = pLimit(CONCURRENCY);
    const promiseList: Array<Promise<void>> = [];
    this.breakpointInfoMap.forEach((info: BreakpointInfo, id: BreakpointId) => {
      promiseList.push(
          limit(() => this.wrapper.debuggeesBreakpointsDelete(id)));
    });
    this.breakpointInfoMap.clear();
    await Promise.all(promiseList);
  }

  async removePendingBreakpointsForFile(path: SourcePath) {
    const limit = pLimit(CONCURRENCY);
    const promiseList: Array<Promise<void>> = [];
    this.breakpointInfoMap.forEach((info: BreakpointInfo, id: BreakpointId) => {
      if (!info[hit] && info.breakpoint.location.path === path) {
        this.breakpointInfoMap.delete(id);
        promiseList.push(
            limit(() => this.wrapper.debuggeesBreakpointsDelete(id)));
      }
    });
    await Promise.all(promiseList);
  }

  async removeBreakpoint(breakpointId: BreakpointId) {
    if (!this.breakpointInfoMap.has(breakpointId)) {
      throw new Error(
          `The breakpoint with ID ${breakpointId}, passed into ` +
          '`removeBreakpoint`, was not set by this instance of `DebugProxy`.');
    }
    this.breakpointInfoMap.delete(breakpointId);
    await this.wrapper.debuggeesBreakpointsDelete(breakpointId);
  }

  async setBreakpoint(breakpointRequest: BreakpointRequest):
      Promise<Breakpoint> {
    const breakpoint =
        await this.wrapper.debuggeesBreakpointsSet(breakpointRequest);
    this.breakpointInfoMap.set(breakpoint.id, {[hit]: false, breakpoint});
    return breakpoint;
  }

  getBreakpointList(captured: boolean): Breakpoint[] {
    return Array.from(this.breakpointInfoMap)
        .filter(([id, info]) => info[hit] === captured)
        .map(([id, info]) => info.breakpoint);
  }
}
