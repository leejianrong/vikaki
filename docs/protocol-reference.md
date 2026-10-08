# Protocol reference

Generated from [protocol.schema.json](protocol.schema.json) by `pnpm --filter @vikaki/protocol schema`. Do not edit by hand. This lists every message and its fields; what the messages mean, who may send them and when is in [protocol.md](protocol.md).

Every message carries `protocol_version` (1) and `type`. A field marked `no` may be left out.

## `hello`

| field | type | required | bounds |
| --- | --- | --- | --- |
| `session_id` | string | no | 1 to 128 characters |
| `role` | one of `driver`, `viewer`, `controller` | yes |  |
| `token` | string | no | at most 256 characters |
| `client` | string | no | at most 64 characters |
| `persona` | string | no | 1 to 64 characters |

## `welcome`

| field | type | required | bounds |
| --- | --- | --- | --- |
| `session_id` | string | no | 1 to 128 characters |
| `role` | one of `driver`, `viewer`, `controller` | yes |  |
| `speech` | string | no | at most 64 characters |
| `voice` | string | no | at most 64 characters |
| `personas` | list of string | no | at most 256 items, each 1 to 64 characters |

## `utterance`

| field | type | required | bounds |
| --- | --- | --- | --- |
| `session_id` | string | no | 1 to 128 characters |
| `seat_id` | string | yes | 1 to 128 characters |
| `utterance_id` | string | yes | 1 to 128 characters |
| `text` | string | no | 1 to 5000 characters |
| `delta` | string | no | 1 to 5000 characters |
| `final` | boolean | no |  |
| `emotion` | string | no | at most 32 characters |
| `intensity` | number | no | 0 to 1 |
| `persona` | string | no | 1 to 64 characters |
| `kind` | one of `banter`, `clue`, `table_talk` | no |  |

## `cancel`

| field | type | required | bounds |
| --- | --- | --- | --- |
| `session_id` | string | no | 1 to 128 characters |
| `utterance_id` | string | no | 1 to 128 characters |

## `turn_started`

| field | type | required | bounds |
| --- | --- | --- | --- |
| `session_id` | string | no | 1 to 128 characters |
| `seat_id` | string | yes | 1 to 128 characters |
| `persona` | string | no | 1 to 64 characters |

## `turn_ended`

| field | type | required | bounds |
| --- | --- | --- | --- |
| `session_id` | string | no | 1 to 128 characters |
| `seat_id` | string | yes | 1 to 128 characters |
| `persona` | string | no | 1 to 64 characters |

## `game_over`

| field | type | required | bounds |
| --- | --- | --- | --- |
| `session_id` | string | no | 1 to 128 characters |
| `outcome` | one of `won`, `lost`, `drew` | yes |  |
| `seat_id` | string | no | 1 to 128 characters |

## `speech_started`

| field | type | required | bounds |
| --- | --- | --- | --- |
| `session_id` | string | no | 1 to 128 characters |
| `utterance_id` | string | yes | 1 to 128 characters |
| `seat_id` | string | no | 1 to 128 characters |

## `speech_finished`

| field | type | required | bounds |
| --- | --- | --- | --- |
| `session_id` | string | no | 1 to 128 characters |
| `utterance_id` | string | yes | 1 to 128 characters |
| `timing` | object | no |  |

## `speech_interrupted`

| field | type | required | bounds |
| --- | --- | --- | --- |
| `session_id` | string | no | 1 to 128 characters |
| `utterance_id` | string | yes | 1 to 128 characters |
| `reason` | one of `cancelled`, `superseded`, `human_spoke`, `driver_disconnected` | yes |  |

## `audio`

| field | type | required | bounds |
| --- | --- | --- | --- |
| `session_id` | string | no | 1 to 128 characters |
| `utterance_id` | string | yes | 1 to 128 characters |
| `seat_id` | string | no | 1 to 128 characters |
| `seq` | integer | yes | 0 to 9007199254740991 |
| `sample_rate` | integer | yes | 8000 to 48000 |
| `pcm` | string | yes | at most 2000000 characters |
| `final` | boolean | yes |  |
| `sentence_index` | integer | no | 0 to 9007199254740991 |
| `sentence_text` | string | no | at most 4000 characters |
| `sentence_end` | boolean | no |  |

## `error`

| field | type | required | bounds |
| --- | --- | --- | --- |
| `session_id` | string | no | 1 to 128 characters |
| `code` | one of `bad_message`, `unsupported_protocol_version`, `unauthorized`, `driver_busy`, `not_allowed`, `unknown_persona`, `tts_failed`, `internal` | yes |  |
| `message` | string | yes | at most 500 characters |
| `utterance_id` | string | no | 1 to 128 characters |
