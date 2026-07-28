/**
 * Mock in-memory OPFS para tests
 *
 * Simula el Origin Private File System del navegador
 * sin necesitar un entorno real de Chrome.
 */

class MockFile {
  name: string
  private _text: string
  constructor(name: string, text: string) {
    this.name = name
    this._text = text
  }
  async text() {
    return this._text
  }
}

class MockFileHandle {
  kind = 'file' as const
  private _content = ''
  name: string
  constructor(name: string) {
    this.name = name
  }
  async getFile() {
    return new MockFile(this.name, this._content)
  }
  async createWritable() {
    const self = this
    return {
      write: async (data: any) => {
        if (typeof data === 'string') {
          self._content = data
        }
        else if (typeof data.text === 'function') {
          self._content = await data.text()
        }
      },
      close: async () => {},
    }
  }
}

class MockDirectoryHandle {
  kind = 'directory' as const
  private _children = new Map<string, MockDirectoryHandle | MockFileHandle>()

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    if (!this._children.has(name) && options?.create) {
      this._children.set(name, new MockDirectoryHandle())
    }
    return this._children.get(name) as MockDirectoryHandle
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this._children.has(name) && options?.create) {
      this._children.set(name, new MockFileHandle(name))
    }
    return this._children.get(name) as MockFileHandle
  }

  async removeEntry(name: string, _options?: { recursive?: boolean }) {
    this._children.delete(name)
  }

  async *entries(): AsyncIterableIterator<[string, MockDirectoryHandle | MockFileHandle]> {
    for (const [name, handle] of this._children) {
      yield [name, handle]
    }
  }

  /** Limpiar todo el contenido del directorio */
  clear() {
    this._children.clear()
  }
}

const mockRoot = new MockDirectoryHandle()

function resetMockOpfs() {
  mockRoot.clear()
}

export { MockFile, MockFileHandle, MockDirectoryHandle, mockRoot, resetMockOpfs }
