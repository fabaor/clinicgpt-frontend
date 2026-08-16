declare module '@jscad/stl-serializer' {
  /**
   * Serializa geometrias JSCAD em STL. Com `binary: true` devolve os pedaços do
   * arquivo como ArrayBuffer; com `binary: false`, como texto ASCII.
   */
  const serializer: {
    serialize: (
      options: { binary?: boolean; statusCallback?: (status: unknown) => void },
      ...objects: unknown[]
    ) => Array<ArrayBuffer | string>
  }
  export default serializer
}
