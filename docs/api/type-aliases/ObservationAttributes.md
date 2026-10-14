[**NeuroLink API Reference**](../README.md)

---

[NeuroLink API Reference](../README.md) / ObservationAttributes

# Type Alias: ObservationAttributes

> **ObservationAttributes** = `object`

## Description

Attributes stamped on an observation span by `observe`.

## Properties

### input?

> `optional` **input?**: [`Unknown`](Unknown.md)

---

### output?

> `optional` **output?**: [`Unknown`](Unknown.md)

---

### metadata?

> `optional` **metadata?**: `Record`\<`string`, [`SpanContent`](SpanContent.md) \| `undefined`\>

---

### level?

> `optional` **level?**: [`ObservationLevel`](ObservationLevel.md)

---

### statusMessage?

> `optional` **statusMessage?**: `string`

---

### completionStartTime?

> `optional` **completionStartTime?**: `Date`

---

### model?

> `optional` **model?**: `string`

---

### modelParameters?

> `optional` **modelParameters?**: `Record`\<`string`, `string` \| `number`\>

---

### usageDetails?

> `optional` **usageDetails?**: `Record`\<`string`, `number`\>

---

### costDetails?

> `optional` **costDetails?**: `Record`\<`string`, `number`\>
