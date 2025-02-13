/* eslint-disable @typescript-eslint/no-explicit-any */
import { collect } from 'streaming-iterables'
import { ServerClosure, Subscription } from '../types'

export const getFilteredSubs = async ({
  server,
  event,
}: {
  server: Omit<ServerClosure, 'gateway'>
  event: { topic: string, payload?: Record<string, any> }
}): Promise<Subscription[]> => {
  if (!event.payload || Object.keys(event.payload).length === 0) {
    server.log('getFilteredSubs', { event })

    const iterator = server.models.subscription.query({
      IndexName: 'TopicIndex',
      ExpressionAttributeNames: { '#a': 'topic' },
      ExpressionAttributeValues: { ':1': event.topic },
      KeyConditionExpression: '#a = :1',
    })

    return await collect(iterator)
  }
  const flattenPayload = collapseKeys(event.payload)

  const filterExpressions: string[] = []
  const expressionAttributeValues: {
    [key: string]: string | number | boolean
  } = {}
  const expressionAttributeNames: { [key: string]: string } = {}

  let attributeCounter = 0
  for (const [key, value] of Object.entries(flattenPayload)) {
    const aliasNumber = attributeCounter++
    const keyParts = key.split('.')
    const keyPartsAttributeName = keyParts
      .map((part, index) => `#${aliasNumber + index}`)
      .join('.')
    key.split('.').forEach((keyPart, index) => {
      expressionAttributeNames[`#${aliasNumber + index}`] = keyPart
      attributeCounter += index
    })
    expressionAttributeValues[`:${aliasNumber}`] = value

    filterExpressions.push(
      `(#filter.${keyPartsAttributeName} = :${aliasNumber} OR attribute_not_exists(#filter.${keyPartsAttributeName}))`,
    )
  }

  server.log('getFilteredSubs', {
    event,
    expressionAttributeNames,
    expressionAttributeValues,
    filterExpressions,
  })

  const iterator = server.models.subscription.query({
    IndexName: 'TopicIndex',
    ExpressionAttributeNames: {
      '#hashKey': 'topic',
      '#filter': 'filter',
      ...expressionAttributeNames,
    },
    ExpressionAttributeValues: {
      ':hashKey': event.topic,
      ...expressionAttributeValues,
    },
    KeyConditionExpression: '#hashKey = :hashKey',
    FilterExpression: filterExpressions.join(' AND ') || undefined,
  })

  return await collect(iterator)
}

export const collapseKeys = (
  obj: Record<string, any>,
): Record<string, number | string | boolean> => {
  const record = {}
  for (const [k1, v1] of Object.entries(obj)) {
    if (
      typeof v1 === 'string' ||
      typeof v1 === 'number' ||
      typeof v1 === 'boolean'
    ) {
      record[k1] = v1
      continue
    }

    if (v1 && typeof v1 === 'object') {
      const next = {}

      for (const [k2, v2] of Object.entries(v1)) {
        next[`${k1}.${k2}`] = v2
      }

      for (const [k1, v1] of Object.entries(collapseKeys(next))) {
        record[k1] = v1
      }
    }
  }
  return record
}
