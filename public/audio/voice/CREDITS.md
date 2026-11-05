# Character voices

Rendered by `tools/build-voices.py`: an invented language (Vashk, no meaning) spoken by Piper neural TTS voices fed raw
phonemes, then pitched and, for the masked characters, filtered. All five voice models are trained on CC0 data
(public domain: commercial use allowed, no attribution required).

| Character | Voice model | Dataset licence |
|---|---|---|
| The Overlord | `fa_IR-reza_ibrahim-medium` | CC0 |
| Rebel Leader | `fa_IR-amir-medium` | CC0 |
| Bandit Leader | `ru_RU-denis-medium` | CC0 |
| The Smuggler | `ru_RU-dmitri-medium` | CC0 |
| Field Report (the Aide) | `sk_SK-lili-medium` | CC0 |

Models: https://huggingface.co/rhasspy/piper-voices (model cards next to each voice). Engine: Piper
(https://github.com/OHF-Voice/piper1-gpl), used offline as a tool; only its audio output ships.
