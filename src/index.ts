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
import {EventEmitter} from 'events';
import {clouddebugger_v2} from 'googleapis';
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

const ABORTED_ERROR_CODE = 409;  // google.rpc.Code.ABORTED

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
   * @param keyFilename - path to the GCP credentials key file
   * corresponding to the project that is to be debugged
   */
  setProjectByKeyFile(keyFilename?: SourcePath): Promise<void>;

  // TODO: setProjectById.
  // https://github.com/GoogleCloudPlatform/cloud-debug-proxy-common/issues/14

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
  private readonly wrapper: Wrapper;
  private readonly localBreakpoints = new Set<BreakpointId>();
  private breakpointList: Breakpoint[] = [];
  private localOnly: boolean = false;

  constructor(readonly options: Options) {
    super();
    this.wrapper = new Wrapper();
  }

  async updatePendingBreakpoints(
      block: boolean, localOnly = false, includeAllUsers = false, includeInactive = true) {

    this.localOnly = localOnly;
    /* debuggees.breakpoints.list times out until the breakpoint list changes.
     * On timeout, it returns the error code google.rpc.Code.ABORTED, and
     * the request should be made again until the breakpoint list changes.
     */
    while (true) {
      try {
        this.breakpointList = await this.wrapper.debuggeesBreakpointsList(
            block, includeAllUsers, includeInactive);
        break;
      } catch (error) {
        if (!error.response || error.response.status !== ABORTED_ERROR_CODE) {
          throw error;
        }
      }
    }

    this.emit('updatedBreakpoints');
  }

  getProjectId(): ProjectId {
    return this.wrapper.getProjectId();
  }

  async setProjectByKeyFile(keyFilename?: SourcePath) {
    await this.wrapper.authorize(keyFilename);
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

  async getBreakpoint(breakpointId: BreakpointId): Promise<Breakpoint> {
    this.checkLocalState(breakpointId);
    return await this.wrapper.debuggeesBreakpointsGet(breakpointId);
  }

  async removeBreakpoint(breakpointId: BreakpointId) {
    this.checkLocalState(breakpointId);
    await this.wrapper.debuggeesBreakpointsDelete(breakpointId);
  }

  async setBreakpoint(breakpointRequest: BreakpointRequest):
      Promise<Breakpoint> {
    const breakpoint =
        await this.wrapper.debuggeesBreakpointsSet(breakpointRequest);
    this.localBreakpoints.add(breakpoint.id);
    return breakpoint;
  }

  getBreakpointList(): Breakpoint[] {
    return this.localOnly ?
        this.breakpointList.filter(
            (breakpoint) => this.localBreakpoints.has(breakpoint.id)) :
        this.breakpointList;
  }

  private checkLocalState(breakpointId: BreakpointId) {
    if (this.localOnly && !this.localBreakpoints.has(breakpointId)) {
      throw new Error('invalid operation');
    }
  }
}
