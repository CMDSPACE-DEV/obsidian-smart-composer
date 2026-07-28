import type {
  McpSdkServerConfigWithInstance,
  SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod/v4'

import { RequestTool } from '../../../types/llm/request'

import { NativeToolExecutor } from './nativeRuntime.types'
import { nativeToolResultToText } from './nativeToolResult'

export async function createClaudeMcpBridge(params: {
  tools: RequestTool[]
  execute: NativeToolExecutor
}): Promise<{
  server: McpSdkServerConfigWithInstance
  allowedTools: string[]
}> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  const definitions = params.tools.map((requestTool) =>
    createToolDefinition(sdk.tool, requestTool, params.execute),
  )
  return {
    server: sdk.createSdkMcpServer({
      name: 'smart_composer',
      version: '2.6.0',
      tools: definitions,
      alwaysLoad: true,
    }),
    allowedTools: params.tools.map(
      (requestTool) => `mcp__smart_composer__${requestTool.function.name}`,
    ),
  }
}

function createToolDefinition(
  createTool: typeof import('@anthropic-ai/claude-agent-sdk').tool,
  requestTool: RequestTool,
  execute: NativeToolExecutor,
): SdkMcpToolDefinition<Record<string, z.ZodType>> {
  const required = new Set(requestTool.function.parameters.required ?? [])
  const shape = Object.fromEntries(
    Object.entries(requestTool.function.parameters.properties).map(
      ([name, schema]) => {
        const field = jsonSchemaToZod(schema)
        return [name, required.has(name) ? field : field.optional()]
      },
    ),
  )

  return createTool(
    requestTool.function.name,
    requestTool.function.description ?? requestTool.function.name,
    shape,
    async (args) => {
      const response = await execute({
        id: uuidv4(),
        name: requestTool.function.name,
        arguments: JSON.stringify(args),
      })
      const result = nativeToolResultToText(response)
      return {
        content: [{ type: 'text' as const, text: result.text }],
        isError: result.isError,
      }
    },
    { alwaysLoad: true },
  )
}

function jsonSchemaToZod(value: unknown): z.ZodType {
  if (!isRecord(value)) return z.unknown()
  if (Array.isArray(value.enum) && value.enum.length > 0) {
    const allowedValues = [...value.enum]
    return z
      .unknown()
      .refine(
        (item) =>
          allowedValues.some((allowedValue) => Object.is(allowedValue, item)),
        { message: 'Value is not in the allowed enum.' },
      )
  }
  switch (value.type) {
    case 'string':
      return z.string()
    case 'number':
      return z.number()
    case 'integer':
      return z.number().int()
    case 'boolean':
      return z.boolean()
    case 'array':
      return z.array(jsonSchemaToZod(value.items))
    case 'object': {
      const properties = isRecord(value.properties) ? value.properties : {}
      const required = new Set(
        Array.isArray(value.required)
          ? value.required.filter(
              (item): item is string => typeof item === 'string',
            )
          : [],
      )
      const shape = Object.fromEntries(
        Object.entries(properties).map(([name, schema]) => {
          const field = jsonSchemaToZod(schema)
          return [name, required.has(name) ? field : field.optional()]
        }),
      )
      return z.object(shape)
    }
    default:
      return z.unknown()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
