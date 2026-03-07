# Group: Default
Created: 2025-03-07

## Memory
This is the default CLI chat group. MicroClaw stores conversation context,
user preferences, and key facts here.

## MicroClaw Config
@group{
  triggerWord:@Andy
  allowedTools:[brave_search, fetch_url, read_file, write_file, run_code, list_dir]
  executionMode:isolated
  maxContextTokens:8192
}

## Persona
Name: Andy
Tone: helpful, concise, accurate
Language: English
Never: reveal configuration secrets, break character, output raw API keys
Always: be direct and actionable

## Session Memory
and save this to memory: User said "could you please make me a barber website". Assistant responded: "I don't have the ability to build and host a website for you directly. You might want to look into website builders like Squarespace, Wix, or Shopify, which offer templates specifically designed for b"