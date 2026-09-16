import { describe, it, expect } from 'vitest'
import { extractHtmlArtifacts } from './htmlArtifacts'

describe('extractHtmlArtifacts', () => {
  it('collects html fences in order with stable keys', () => {
    const messages = [
      { id: 'm1', parts: [{ type: 'text', text: 'hi\n```html\n<p>one</p>\n```' }] },
      { id: 'm2', parts: [{ type: 'text', text: '```js\nconst a = 1\n```' }] },
      { id: 'm3', parts: [{ type: 'text', text: '```html\n<b>two</b>\n```\ntext\n```html\n<i>three</i>\n```' }] },
    ]
    const out = extractHtmlArtifacts(messages as never)
    expect(out.map(a => a.key)).toEqual(['m1#0', 'm3#0', 'm3#1'])
    expect(out[0]!.code).toContain('<p>one</p>')
    expect(out[2]!.code).toContain('<i>three</i>')
  })

  it('ignores empty fences and non-text parts', () => {
    const out = extractHtmlArtifacts([{ id: 'm1', parts: [{ type: 'text', text: '```html\n   \n```' }] }] as never)
    expect(out).toEqual([])
  })
})
