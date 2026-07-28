import { describe, expect, it } from 'vitest'
import { tavilyExtractTool, tavilySearchTool } from './tavilyTools'

describe('tavily tools', () => {
  it('exportan inputSchema en formato AI SDK v6', () => {
    expect(tavilySearchTool).toHaveProperty('inputSchema')
    expect(tavilyExtractTool).toHaveProperty('inputSchema')
    expect(tavilySearchTool).not.toHaveProperty('parameters')
    expect(tavilyExtractTool).not.toHaveProperty('parameters')
  })
})
