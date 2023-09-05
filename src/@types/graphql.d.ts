declare module '*.graphql' {
  import { TypedDocumentNode } from 'urql'
  const Schema: TypedDocumentNode

  export = Schema
}
