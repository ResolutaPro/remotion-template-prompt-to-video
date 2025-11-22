# Template de Vídeo com Remotion AI

<p align="center">
  <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://cdn.webmonch.dev/img/remotion-template-promo.png">
      <img alt="Animated Remotion Logo" src="https://cdn.webmonch.dev/img/remotion-template-promo.png">
    </picture>
</p>

Com este template você cria **vídeos com IA de alta qualidade para TikTok ou Instagram**.

Ele inclui uma CLI que gera roteiro, imagens e narração usando OpenAI e ElevenLabs (ou um TTS local, se configurado).

## Primeiros passos

Configure a história de demonstração:

**Instale as dependências**

```console
npm install
```

**Inicie o Preview**

```console
npm run dev
```

**Renderize o vídeo**

```console
npx remotion render
```

Ou consulte a [documentação do Remotion](/docs/render/) para outras formas de renderizar.

## Criando uma nova história

Você pode criar novos vídeos usando a CLI inclusa.

Ela gera roteiro, imagens, narração e timeline a partir do título e do tema da história. Temas que funcionam bem: história, ELI5, curiosidades, ciência.

**Configure variáveis de ambiente**

Crie um arquivo `.env` com as variáveis abaixo (também estão em `.env.example`):

```
OPENAI_API_KEY=
ELEVENLABS_API_KEY=
LOCAL_TTS_URL=
LOCAL_TTS_MODEL=tts
LOCAL_TTS_BACKEND=
LOCAL_TTS_VOICE=
LOCAL_TTS_LANGUAGE=
LOCAL_TTS_RESPONSE_FORMAT=mp3
```

Somente `OPENAI_API_KEY` é obrigatória. Se quiser rodar a síntese de voz localmente (ex.: [LocalAI](https://localai.io/features/text-to-audio/)), defina ao menos `LOCAL_TTS_URL` apontando para o endpoint `/tts`. Quando `LOCAL_TTS_URL` está presente, a CLI ignora o ElevenLabs e passa a gerar áudio via seu servidor local, usando os demais parâmetros `LOCAL_TTS_*` (modelo/backend/voz/idioma/formato) se informados. Deixe-os em branco para usar os padrões do seu TTS local.

Para seguir com ElevenLabs, deixe `LOCAL_TTS_URL` vazio e informe `ELEVENLABS_API_KEY`. A CLI só solicitará a chave se nenhum dos dois estiver configurado.

Sem o arquivo `.env`, a CLI pedirá todos os valores durante a execução.

**Escolha a voz**

- **TTS local**: ajuste as variáveis `LOCAL_TTS_*` para selecionar voz/modelo (por exemplo `LOCAL_TTS_BACKEND=coqui` ou `LOCAL_TTS_MODEL=tts_models/multilingual/multi-dataset/xtts_v2`).
- **ElevenLabs**: em [`generateElevenLabsVoice()`](cli/service.ts) substitua o ID da voz padrão pela voz desejada. Dá para obter o ID via API ou abrindo uma voz no site e copiando o valor após `voiceId=` na URL.

```console
https://elevenlabs.io/app/voice-library?voiceId=aTxZrSrp47xsP6Ot4Kgd
```

**Gere a timeline da história**

```console
npm run gen
```

A CLI pedirá o título e o tema da história.

O título pode ser curto ou detalhado; a primeira tela usará uma versão resumida. Escolha um tema como História, Curiosidades, ELI5 etc.

Após fornecer título e tema, a CLI gera texto, imagens e áudio com timestamps e monta a timeline usada pelo template na renderização.

## Visão técnica

O Remotion renderiza o vídeo a partir da timeline (`timeline.json` no projeto), gerada pela CLI.

Ela possui três blocos: elementos, textos e áudio.

- **Elements** definem os fundos de cada slide, com transições (ex.: blur) e animações (ex.: scale, rotate).
- **Text** e **audio** ficam sincronizados para destacar o trecho narrado.

Você pode personalizar como a timeline é criada em [`createTimeLineFromStoryWithDetails()`](cli/timeline.ts).

## Deploy em servidor remoto

Este projeto precisa de ajustes leves para rodar como serviço remoto.

1. Faça o deploy do renderer do Remotion com o bundle do template normalmente.
2. Atualize [`Root.tsx`](src/Root.tsx) para receber a URL da timeline via prop (em vez do nome do projeto).
3. Envie os recursos gerados (imagens/áudios) para um servidor e use URLs absolutas ao montar a timeline.

## Problemas

Encontrou algum bug no Remotion? Atualize para receber correções:

```
npx remotion upgrade
```

Não resolveu? [Abra uma issue aqui](https://github.com/remotion-dev/remotion/issues/new).

## Contribuição

O template original está no [Monorepo do Remotion](https://github.com/remotion-dev/remotion/tree/main/packages/template-ai-video).  
Não envie PRs para este repositório: ele é apenas um espelho.

## Licença

Algumas empresas precisam de licença comercial. [Leia os termos aqui](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md).

## Créditos

Agradecimentos a [@webmonch](https://github.com/webmonch) por contribuir com este template!
