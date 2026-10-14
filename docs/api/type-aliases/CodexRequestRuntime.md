[**NeuroLink API Reference**](../README.md)

---

[NeuroLink API Reference](../README.md) / CodexRequestRuntime

# Type Alias: CodexRequestRuntime

> **CodexRequestRuntime** = `object`

Everything the Codex request helpers need to serve and account one turn.

## Properties

### ctx

> **ctx**: [`ServerContext`](ServerContext.md)

---

### model

> **model**: `string`

---

### tracer?

> `optional` **tracer?**: `ProxyTracer`

---

### requestStartTime

> **requestStartTime**: `number`

---

### isFallbackRequest

> **isFallbackRequest**: `boolean`

---

### state

> **state**: [`CodexRequestState`](CodexRequestState.md)

---

### runtimeConfigProvider?

> `optional` **runtimeConfigProvider?**: [`ProxyRuntimeConfigProvider`](ProxyRuntimeConfigProvider.md)

---

### loopbackPort?

> `optional` **loopbackPort?**: `number`

---

### internalDispatch?

> `optional` **internalDispatch?**: (`request`) => `Response` \| `Promise`\<`Response`\>

#### Parameters

##### request

`Request`

#### Returns

`Response` \| `Promise`\<`Response`\>

---

### settleBudget

> **settleBudget**: (`actualTokens?`) => `Promise`\<`void`\>

#### Parameters

##### actualTokens?

`number`

#### Returns

`Promise`\<`void`\>

---

### recordFinalOutcome

> **recordFinalOutcome**: (`account`, `responseStatus`, `extra?`) => `Promise`\<`void`\>

#### Parameters

##### account

[`CodexRuntimeAccount`](CodexRuntimeAccount.md) \| `undefined`

##### responseStatus

`number`

##### extra?

[`CodexFinalLogExtra`](CodexFinalLogExtra.md)

#### Returns

`Promise`\<`void`\>

---

### writeAttempt

> **writeAttempt**: (`account`, `attempt`, `startedAt`, `responseStatus`, `extra?`) => `void`

#### Parameters

##### account

[`CodexRuntimeAccount`](CodexRuntimeAccount.md)

##### attempt

`number`

##### startedAt

`number`

##### responseStatus

`number`

##### extra?

[`CodexAttemptLogExtra`](CodexAttemptLogExtra.md)

#### Returns

`void`
