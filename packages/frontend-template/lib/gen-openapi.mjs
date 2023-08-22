import CodeBlockWriter from 'code-block-writer'
import jsonpointer from 'jsonpointer'
import { generateOperationId } from '@platformatic/client'
import { capitalize, classCase } from './utils.mjs'
import { STATUS_CODES } from 'node:http'

export function processOpenAPI ({ schema, name, url, language }) {
  return {
    types: generateTypesFromOpenAPI({ schema, name }),
    implementation: generateFrontendImplementationFromOpenAPI({ schema, name, url, language })
  }
}

function generateFrontendImplementationFromOpenAPI ({ schema, name, url, language }) {
  const capitalizedName = capitalize(name)
  const { paths } = schema
  const generatedOperationIds = []
  const operations = Object.entries(paths).flatMap(([path, methods]) => {
    return Object.entries(methods).map(([method, operation]) => {
      const opId = generateOperationId(path, method, operation, generatedOperationIds)
      return {
        path,
        method,
        operation: {
          ...operation,
          operationId: opId
        }
      }
    })
  })

  /* eslint-disable new-cap */
  const writer = new CodeBlockWriter({
    indentNumberOfSpaces: 2,
    useTabs: false,
    useSingleQuote: true
  })

  writer.write('// This client was generated by Platformatic from an OpenAPI specification.')
  writer.blankLine()

  writer.conditionalWriteLine(language === 'ts', `import type { ${capitalizedName} } from './${name}-types'`)
  writer.blankLineIfLastNot()

  writer.writeLine('// The base URL for the API. This can be overridden by calling `setBaseUrl`.')
  writer.writeLine('let baseUrl = \'\'')
  if (language === 'ts') {
    writer.writeLine(
      'export const setBaseUrl = (newUrl: string) : void => { baseUrl = newUrl }'
    )
  } else {
    writer.writeLine(
      '/**  @type {import(\'./api-types.d.ts\').setBaseUrl} */'
    )
    writer.writeLine(
      'export const setBaseUrl = (newUrl) => { baseUrl = newUrl }'
    )
  }
  writer.blankLine()

  for (const operation of operations) {
    const { operationId, responses } = operation.operation
    const { method, path } = operation
    let fullResponse = false
    // Only dealing with success responses
    const successResponses = Object.entries(responses).filter(([s]) => s.startsWith('2'))

    /* c8 ignore next 3 */
    if (successResponses.length !== 1) {
      fullResponse = true
    }

    if (language === 'ts') {
      // Write
      //
      // ```ts
      // export const getMovies:Api['getMovies'] = async (request) => {
      // ```
      writer.write(
          `export const ${operationId}: ${capitalizedName}['${operationId}'] = async (request) =>`
      )
    } else {
      // The JS version uses the JSDoc type format to offer IntelliSense autocompletion to the developer.
      //
      // ```js
      // /** @type {import('./api-types.d.ts').Api['getMovies']} */
      // export const getMovies = async (request) => {
      // ```
      //
      writer.writeLine(
        `/**  @type {import('./api-types.d.ts').Api['${operationId}']} */`
      ).write(`export const ${operationId} = async (request) =>`)
    }

    writer.block(() => {
      // Transform
      // /organizations/{orgId}/members/{memberId}
      // to
      // /organizations/${request.orgId}/members/${request.memberId}
      const stringLiteralPath = path.replace(/\{/gm, '${request.')

      // GET methods need query strings instead of JSON bodies
      if (method === 'get') {
        writer.writeLine(
          `const response = await fetch(\`\${baseUrl}${stringLiteralPath}?\${new URLSearchParams(Object.entries(request || {})).toString()}\`)`
        )
      } else {
        writer
          .write(`const response = await fetch(\`\${baseUrl}${stringLiteralPath}\`, `)
          .inlineBlock(() => {
            writer.write('method:').quote().write(method).quote().write(',')
            writer.writeLine('body: JSON.stringify(request),')
            writer.write('headers:').block(() => {
              writer
                .quote()
                .write('Content-Type')
                .quote()
                .write(': ')
                .quote()
                .write('application/json')
                .quote()
            })
          })
          .write(')')
      }

      writer.blankLine()
      if (fullResponse) {
        writer.write('let body = await response.text()')

        writer.blankLine()

        writer.write('try').block(() => {
          writer.write('body = JSON.parse(await response.json())')
        })
        writer.write('catch (err)').block(() => {
          writer.write('// do nothing and keep original body')
        })

        writer.blankLine()

        writer.write('return').block(() => {
          writer.write('statusCode: response.status,')
          writer.newLine()
          writer.write('headers: response.headers,')
          writer.newLine()
          writer.write('body')
        })
      } else {
        writer.write('if (!response.ok)').block(() => {
          writer.writeLine('throw new Error(await response.text())')
        })

        writer.blankLine()

        writer.writeLine('return await response.json()')
      }
    })
    writer.blankLine()
  }

  return writer.toString()
}

function generateTypesFromOpenAPI ({ schema, name }) {
  const capitalizedName = capitalize(name)
  const { paths } = schema
  const generatedOperationIds = []
  const operations = Object.entries(paths).flatMap(([path, methods]) => {
    return Object.entries(methods).map(([method, operation]) => {
      const opId = generateOperationId(path, method, operation, generatedOperationIds)
      return {
        path,
        method,
        operation: {
          ...operation,
          operationId: opId
        }
      }
    })
  })
  /* eslint-disable new-cap */
  const writer = new CodeBlockWriter({
    indentNumberOfSpaces: 2,
    useTabs: false,
    useSingleQuote: true
  })

  const interfaces = new CodeBlockWriter({
    indentNumberOfSpaces: 2,
    useTabs: false,
    useSingleQuote: true
  })
  /* eslint-enable new-cap */
  interfaces.write('interface FullResponse<T>').block(() => {
    interfaces.writeLine('\'statusCode\': number;')
    interfaces.writeLine('\'headers\': object;')
    interfaces.writeLine('\'body\': T;')
  })
  interfaces.blankLine()

  writer.write(`export interface ${capitalizedName}`).block(() => {
    writer.writeLine('setBaseUrl(newUrl: string) : void;')
    for (const operation of operations) {
      let fullResponse = false
      const operationId = operation.operation.operationId
      const { parameters, responses, requestBody } = operation.operation
      const operationRequestName = `${capitalize(operationId)}Request`
      const operationResponseName = `${capitalize(operationId)}Response`
      interfaces.write(`interface ${operationRequestName}`).block(() => {
        const addedProps = new Set()
        if (parameters) {
          for (const parameter of parameters) {
            const { name, schema, required } = parameter
            // We do not check for addedProps here because it's the first
            // group of properties
            writeProperty(interfaces, name, schema, addedProps, required)
          }
        }
        if (requestBody) {
          writeContent(interfaces, requestBody.content, schema, addedProps)
        }
      })
      interfaces.blankLine()

      // Only dealing with success responses
      const successResponses = Object.entries(responses).filter(([s]) => s.startsWith('2'))
      // The following block it's impossible to happen with well-formed
      // OpenAPI.
      /* c8 ignore next 3 */
      if (successResponses.length !== 1) {
        fullResponse = true
      }
      const responseTypes = Object.entries(responses).map(([statusCode, response]) => {
        // The client library will always dump bodies for 204 responses
        // so the type must be undefined
        if (statusCode === '204') {
          return 'undefined'
        }

        // Unrecognized status code
        if (STATUS_CODES[statusCode] === undefined) {
          return 'undefined'
        }
        let isResponseArray
        let type = `${operationResponseName}${classCase(STATUS_CODES[statusCode])}`
        interfaces.write(`interface ${type}`).block(() => {
          isResponseArray = writeContent(interfaces, response.content, schema, new Set())
        })
        interfaces.blankLine()
        if (isResponseArray) type = `Array<${type}>`
        if (fullResponse) type = `FullResponse<${type}>`
        return type
      })

      const responseType = responseTypes.join(' | ')
      writer.writeLine(`${operationId}(req: ${operationRequestName}): Promise<${responseType}>;`)
    }
  })

  writer.blankLine()

  return interfaces.toString() + writer.toString()
}

function writeContent (writer, content, spec, addedProps) {
  let isResponseArray = false
  if (content) {
    for (const [contentType, body] of Object.entries(content)) {
      // We ignore all non-JSON endpoints for now
      // TODO: support other content types
      /* c8 ignore next 3 */
      if (contentType.indexOf('application/json') !== 0) {
        continue
      }

      // Response body has no schema that can be processed
      // Should not be possible with well formed OpenAPI
      /* c8 ignore next 3 */
      if (!body.schema?.type && !body.schema?.$ref) {
        break
      }

      // This is likely buggy as there can be multiple responses for different
      // status codes. This is currently not possible with Platformatic DB
      // services so we skip for now.
      // TODO: support different schemas for different status codes
      if (body.schema.type === 'array') {
        isResponseArray = true
        writeObjectProperties(writer, body.schema.items, spec, addedProps)
      } else {
        writeObjectProperties(writer, body.schema, spec, addedProps)
      }
      break
    }
  }
  return isResponseArray
}

function writeObjectProperties (writer, schema, spec, addedProps) {
  if (schema.$ref) {
    schema = jsonpointer.get(spec, schema.$ref.replace('#', ''))
  }
  if (schema.type === 'object') {
    for (const [key, value] of Object.entries(schema.properties)) {
      if (addedProps.has(key)) {
        continue
      }
      const required = schema.required && schema.required.includes(key)
      writeProperty(writer, key, value, addedProps, required)
    }
    // This is unlikely to happen with well-formed OpenAPI.
    /* c8 ignore next 3 */
  } else {
    throw new Error(`Type ${schema.type} not supported`)
  }
}

function writeProperty (writer, key, value, addedProps, required = true) {
  addedProps.add(key)
  if (required) {
    writer.quote(key)
  } else {
    writer.quote(key)
    writer.write('?')
  }
  writer.write(`: ${getType(value)};`)
  writer.newLine()
}

export function getType (typeDef) {
  if (typeDef.schema) {
    return getType(typeDef.schema)
  }
  if (typeDef.anyOf) {
    // recursively call this function
    return typeDef.anyOf.map((t) => {
      return getType(t)
    }).join(' | ')
  }

  if (typeDef.allOf) {
    // recursively call this function
    return typeDef.allOf.map((t) => {
      return getType(t)
    }).join(' & ')
  }
  if (typeDef.type === 'array') {
    return `Array<${getType(typeDef.items)}>`
  }
  if (typeDef.type === 'object') {
    let output = '{ '
    const props = Object.keys(typeDef.properties || {}).map((prop) => {
      return `${prop}: ${getType(typeDef.properties[prop])}`
    })
    output += props.join('; ')
    output += ' }'
    return output
  }
  return JSONSchemaToTsType(typeDef.type)
}
function JSONSchemaToTsType (type) {
  switch (type) {
    case 'string':
      return 'string'
    case 'integer':
      return 'number'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    // TODO what other types should we support here?
    /* c8 ignore next 2 */
    default:
      return 'any'
  }
}
