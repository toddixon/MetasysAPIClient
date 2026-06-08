import { Observable, BehaviorSubject, Subscriber } from "rxjs";
import { GetObjectsResponseItemsInner } from "../api";
import { ObjectSnapshot } from "./copied-object.models";
import { MainPageUniqueProperty } from "./copied-object.models";

/**
 * Preloaded sibling uniqueness context for the paste dialog.
 * Computed before the dialog opens so that validation state is immediately visible.
 */
export interface PasteSiblingContext {
  /** Lowercased label strings of existing sibling objects at the destination. */
  siblingLabels: string[];
  /** Per-property set of normalized values already used by sibling objects. */
  siblingUniqueValues: Map<MainPageUniqueProperty, Set<string>>;
  /** MAC addresses in range 4–127 not yet occupied by any sibling. */
  availableMacAddresses: number[];
}

export type OperationType = 'copy' | 'paste' | 'delete';

export interface ActionWarnEvent {
  operation: OperationType,
  message: string,
  doSomething: string,
  ignore?: string,
  nodes?: GetObjectsResponseItemsInner[],
  /** Selected child nodes that will be ignored because their parent is also selected for deletion. */
  ignoredNodes?: GetObjectsResponseItemsInner[],
  /** Maps a parent node ID to all of its direct children, so the user can see what will be implicitly deleted. */
  parentChildrenMap?: Map<string, GetObjectsResponseItemsInner[]>,
  /** Pre-built operation observable (delete/copy). Absent for paste (built from form values at submit time). */
  doSomethingFn$?: Observable<any>,
  /** Retries the operation for a single node, emitting Processing then Success/Error. */
  retryFn?: (objectId: string) => Observable<ObjectOperationUpdate>,
  /** Items to paste with their copied snapshot data (paste operation only). */
  pasteItems?: ObjectSnapshot[],
  /** Destination parent ID for the paste operation. */
  pasteParentId?: string,
  /** Preloaded sibling uniqueness context (computed before the dialog opens). */
  pasteSiblingContext?: PasteSiblingContext,
  pause$?: BehaviorSubject<boolean>,
  res$?: Subscriber<string>,
}

export type Status = 'Success' | 'Error' | 'Processing' | 'Idle';
// export type SuccessStatus = 'Deleted' | 'Pasted';

export interface ObjectOperation {
  objectId: string,
  name: string,
  reference: string,
  message?: string,
  status: Status,
}

export interface ObjectOperationUpdate extends Pick<ObjectOperation, 'objectId' | 'status' | 'message'> { }

/** Status of a single node during a recursive copy run. */
export type CopyNodeStatus = 'Queued' | 'Processing' | 'Success' | 'Error' | 'Skipped';

/** Reason a node was skipped (not an error in the node itself). */
export type CopySkipReason = 'depth-limit' | 'schema-failed-parent';

export interface CopyNodeState {
  objectId: string;
  name: string;
  status: CopyNodeStatus;
  /** Set when status is Skipped */
  skipReason?: CopySkipReason;
  /** Set when status is Error */
  errorMessage?: string;
  /** Depth relative to the selected copy root (0 = root itself) */
  depth: number;
}

export interface CopyProgressState {
  total: number;
  completed: number;
  currentObjectName: string;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  /**
   * Failed root IDs mapped to the set of descendant IDs that were skipped
   * because their ancestor's schema fetch failed.
   */
  failedSubtrees: Map<string, { rootState: CopyNodeState; skippedDescendants: CopyNodeState[] }>;
  done: boolean;
  /** Max descendant depth that was configured for this run. */
  configuredDepth: number;
}
