export interface EnumSet {
  $schema: string,
  title: string,
  $id: string,
  setId: number,
  oneOf: Array<EnumMember>
}

export interface EnumMember {
  const: string,//* enumSet.XXX
  title: string,
  memberId?: number,
}

export function isEnumMemberArr(obj: unknown): obj is Array<EnumMember> {
  if (Array.isArray(obj)) {
    const keys = Object.keys(obj[0])
    // if (keys as (keyof EnumSet)[]) {
    return true
    // }
  }
  return false;
}