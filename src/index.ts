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
export enum Action {
  CAPTURE = 'CAPTURE',
  LOG = 'LOG',
}
export interface BreakpointRequest extends clouddebugger_v2.Schema$Breakpoint {
  action: Action;
  location: SourceLocation;
}
export interface Breakpoint extends BreakpointRequest {
  id: BreakpointId;
}
export interface PendingBreakpoint extends Breakpoint {
  isFinalState: false;
}
export interface CapturedSnapshot extends Breakpoint {
  isFinalState: true;
  action: Action.CAPTURE;
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
  [hit]: boolean;  // Set after a `breakpointHit` event is emitted.
  path: SourcePath;
}

const ABORTED_ERROR_CODE = 409;  // google.rpc.Code.ABORTED

/** @fires breakpointHit as soon as any breakpoints are hit */
export class DebugProxy extends EventEmitter {
  private wrapper: Wrapper;

  /**
   * We use "our" and "us" to refer to this instance of `DebugProxy`.
   * This `breakpointInfoMap` is our entire state, and is only modified in
   * the `set*` and `remove*` functions. A breakpoint is in this map if and
   * only if it was set by us, so there is no interference with anyone else.
   */
  private readonly breakpointInfoMap = new Map<BreakpointId, BreakpointInfo>();

  constructor(readonly options: Options) {
    super();
    this.wrapper = new Wrapper();
  }

  /**
   * Updates the state of all pending breakpoints set by us.
   *
   * @param block - true to block until breakpoint list changes, otherwise false
   * @fires breakpointHit if any breakpoints were hit since their last checks
   */
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

    // `pendingBreakpointIdSet` has IDs of all pending breakpoints set by us.
    const pendingBreakpointIdSet = new Set<BreakpointId>();
    breakpointList.forEach((breakpoint: Breakpoint) => {
      const id = breakpoint.id;
      if (this.breakpointInfoMap.has(id)) {
        assert.strictEqual(this.breakpointInfoMap.get(id)![hit], false);
        pendingBreakpointIdSet.add(id);
      }
    });

    // A breakpoint in `breakpointInfoMap` but not in `pendingBreakpointIdSet`
    // could be hit since its last check, so check again and update its state.
    const possiblyHitPromiseList: Array<Promise<Breakpoint>> = [];
    this.breakpointInfoMap.forEach((info: BreakpointInfo, id: BreakpointId) => {
      if (!pendingBreakpointIdSet.has(id)) {
        possiblyHitPromiseList.push(this.getBreakpoint(id));
      }
    });

    // These breakpoints have either been hit or removed by someone else.
    let hitAny = false;
    const removedBreakpointPromiseList: Array<Promise<void>> = [];
    // TODO: use https://www.npmjs.com/package/p-limit to rate-limit Promise.all
    const possiblyHitBreakpointList = await Promise.all(possiblyHitPromiseList);
    possiblyHitBreakpointList.forEach((breakpoint: Breakpoint) => {
      if (breakpoint.isFinalState) {
        assert(this.breakpointInfoMap.has(breakpoint.id));
        this.breakpointInfoMap.get(breakpoint.id)![hit] = true;
        hitAny = true;
      } else {
        removedBreakpointPromiseList.push(this.removeBreakpoint(breakpoint.id));
      }
    });

    if (hitAny) {
      this.emit('breakpointHit');
    }
    await Promise.all(removedBreakpointPromiseList);
  }


  /**
   * @returns project ID for the selected GCP project
   */
  getProjectId(): ProjectId {
    return this.wrapper.getProjectId();
  }

  /**
   * @param keyFilename - path to the GCP credentials key file
   * corresponding to the project that is to be debugged
   */
  async setProjectByKeyFile(keyFilename?: SourcePath) {
    await this.wrapper.authorize(keyFilename);
  }

  // TODO: setProjectById.

  /**
   * @returns debugger ID for the selected GCP debuggee
   */
  getDebuggerId(): DebuggerId {
    return this.options.debuggerId;
  }

  /**
   * @param debuggeeId - ID of the debuggee that is to be debugged
   */
  setDebuggeeId(debuggeeId: DebuggeeId) {
    this.wrapper.debuggeeId = debuggeeId;
  }

  /**
   * @returns list of available debuggees for the selected project
   */
  async getDebuggees(): Promise<Debuggee[]> {
    return this.wrapper.debuggeesList();
  }

  /**
   * Retrieves the breakpoint with the given ID.
   *
   * @param breakpointId - ID of the breakpoint to retrieve
   * @returns breakpoint with the given breakpoint ID
   */
  getBreakpoint(breakpointId: BreakpointId): Promise<Breakpoint> {
    if (!this.breakpointInfoMap.has(breakpointId)) {
      throw new Error('The requested breakpoint was not set by us!');
    }
    return this.wrapper.debuggeesBreakpointsGet(breakpointId);
  }

  /** Removes all breakpoints set by us. */
  async removeAllBreakpoints() {
    const promiseList: Array<Promise<void>> = [];
    this.breakpointInfoMap.forEach((info: BreakpointInfo, id: BreakpointId) => {
      promiseList.push(this.wrapper.debuggeesBreakpointsDelete(id));
    });
    this.breakpointInfoMap.clear();
    await Promise.all(promiseList);
  }

  /**
   * Removes all breakpoints in the given file that have not been hit.
   *
   * This function is used by UIs that do not send breakpoints incrementally;
   * that is, UIs that send all pending breakpoints together on every update.
   * These semantics can be implemented by clearing them before each update.
   *
   * @param path - path to the file in which breakpoints should be removed
   */
  async removePendingBreakpointsForFile(path: SourcePath) {
    const promiseList: Array<Promise<void>> = [];
    this.breakpointInfoMap.forEach((info: BreakpointInfo, id: BreakpointId) => {
      if (!info[hit] && info.path === path) {
        this.breakpointInfoMap.delete(id);
        promiseList.push(this.wrapper.debuggeesBreakpointsDelete(id));
      }
    });
    await Promise.all(promiseList);
  }

  /**
   * Removes the breakpoint with the given ID.
   *
   * @param breakpointId - ID of the breakpoint to remove
   */
  async removeBreakpoint(breakpointId: BreakpointId) {
    if (!this.breakpointInfoMap.has(breakpointId)) {
      throw new Error('The requested breakpoint was not set by us!');
    }
    this.breakpointInfoMap.delete(breakpointId);
    await this.wrapper.debuggeesBreakpointsDelete(breakpointId);
  }

  /**
   * Sets a new pending breakpoint.
   *
   * @param breakpointRequest - breakpoint to set
   * @return breakpoint which was successfully set
   */
  async setBreakpoint(breakpointRequest: BreakpointRequest):
      Promise<Breakpoint> {
    const breakpoint =
        await this.wrapper.debuggeesBreakpointsSet(breakpointRequest);
    this.breakpointInfoMap.set(
        breakpoint.id, {[hit]: false, path: breakpoint.location.path});
    return breakpoint;
  }

  /**
   * Retrieves a list of the IDs of all pending or captured snapshots.
   *
   * @param captured - true to get a list of the IDs of all captured snapshots,
   * false to get a list of the IDs of all pending snapshots
   * @returns list of IDs of snapshots of the specified type
   */
  getSnapshotIdList(captured: boolean): BreakpointId[] {
    return Array.from(this.breakpointInfoMap)
        .filter(([id, info]) => info[hit] === captured)
        .map(([id, info]) => id);
  }
}
