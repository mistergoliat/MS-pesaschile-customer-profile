# Customer Profile Architecture

Target flow:

```text
incoming message
-> Identity Resolver
-> master_customer
-> Customer Profile
-> active opportunity
-> conversational context
-> Sales Agent
```

`masterCustomerId` is the public identifier. PrestaShop ids are internal source references only.

This service is read-oriented. Productive profile construction is intentionally deferred.
