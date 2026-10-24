import type {
  JsonValue,
  ObjectRef,
  ProjectFileBinding,
  RelationKind,
  SemanticReference,
} from "../model/index.ts";

export interface DiffOptions {
  readonly ignoreBody?: boolean;
}

export interface HeaderChange {
  /** Dot-separated keys, escaping dots/backslashes with backslashes. Arrays/empty containers are leaves. */
  readonly path: string;
  /** Undefined means absent, never JSON null. JSON serialization omits absent sides. */
  readonly from: JsonValue | undefined;
  readonly to: JsonValue | undefined;
}

export interface ReferenceRetarget {
  readonly field: string;
  readonly kind: RelationKind;
  readonly from: ObjectRef;
  readonly to: ObjectRef;
}

export interface ReferenceChanges {
  readonly added: readonly SemanticReference[];
  readonly removed: readonly SemanticReference[];
  /** Cancel exact occurrences first; singleton groups pair with the first sorted opposite occurrence. */
  readonly retargeted: readonly ReferenceRetarget[];
}

export interface SymbolChange {
  readonly path: string;
  readonly role: ProjectFileBinding["role"];
  readonly from?: string;
  readonly to?: string;
}

export interface BindingChanges {
  readonly added: readonly ProjectFileBinding[];
  readonly removed: readonly ProjectFileBinding[];
  readonly symbolChanged: readonly SymbolChange[];
}

export interface ObjectChange {
  readonly ref: ObjectRef;
  readonly headerChanges: readonly HeaderChange[];
  readonly referenceChanges: ReferenceChanges;
  readonly bindingChanges: BindingChanges;
  readonly bodyChanged: boolean;
  readonly sourcePathChanged: boolean;
  readonly checksumChanged: boolean;
  readonly changed: boolean;
}

export interface GraphDiff {
  readonly added: readonly ObjectRef[];
  readonly removed: readonly ObjectRef[];
  readonly changed: readonly ObjectChange[];
  readonly counts: {
    readonly added: number;
    readonly removed: number;
    readonly changed: number;
    readonly equal: number;
  };
  readonly equal: boolean;
}
