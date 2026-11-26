import { describe, expect, it } from 'vitest'
import { isConvertible } from './documentConversion'

describe('isConvertible', () => {
  it('accepts document formats anydoc supports', () => {
    expect(isConvertible('report.pdf')).toBe(true)
    expect(isConvertible('report.docx')).toBe(true)
    expect(isConvertible('legacy.DOC')).toBe(true)
    expect(isConvertible('slides.pptx')).toBe(true)
    expect(isConvertible('book.epub')).toBe(true)
    expect(isConvertible('notes.rtf')).toBe(true)
    expect(isConvertible('table.xlsx')).toBe(true)
    expect(isConvertible('text.odt')).toBe(true)
  })

  it('rejects files that do not need conversion', () => {
    expect(isConvertible('notes.txt')).toBe(false)
    expect(isConvertible('notes.md')).toBe(false)
    expect(isConvertible('data.csv')).toBe(false)
    expect(isConvertible('data.json')).toBe(false)
    expect(isConvertible('photo.png')).toBe(false)
  })

  it('rejects unknown extensions and extensionless names', () => {
    expect(isConvertible('archive.zip')).toBe(false)
    expect(isConvertible('virus.exe.docx')).toBe(true) // extension is the last one
    expect(isConvertible('README')).toBe(false)
  })
})
