import {
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody
} from 'discord.js';

export const SONORA_COMMAND_NAMES = [
  'play',
  'pause',
  'resume',
  'skip',
  'stop',
  'leave',
  'volume',
  'nowplaying',
  'queue',
  'remove',
  'clear',
  'shuffle',
  'loop',
  'lyrics',
  'help',
  'language'
] as const;

export type SonoraCommandName = (typeof SONORA_COMMAND_NAMES)[number];

export function buildSonoraSlashCommands(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  const commands = [
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('Reproduz uma música ou adiciona à fila (nome, artista ou URL)')
      .setDescriptionLocalizations({
        'en-US': 'Play a song or add it to the queue (name, artist, or URL)',
        'en-GB': 'Play a song or add it to the queue (name, artist, or URL)'
      })
      .addStringOption((opt) =>
        opt
          .setName('query')
          .setDescription('Nome da música/artista ou URL (YouTube, SoundCloud, Spotify, link direto)')
          .setDescriptionLocalizations({
            'en-US': 'Track/artist name or URL (YouTube, SoundCloud, Spotify, direct link)',
            'en-GB': 'Track/artist name or URL (YouTube, SoundCloud, Spotify, direct link)'
          })
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(500)
      ),

    new SlashCommandBuilder()
      .setName('pause')
      .setDescription('Coloca a reprodução atual em pausa')
      .setDescriptionLocalizations({
        'en-US': 'Pause the current playback',
        'en-GB': 'Pause the current playback'
      }),

    new SlashCommandBuilder()
      .setName('resume')
      .setDescription('Retoma a reprodução da música em pausa')
      .setDescriptionLocalizations({
        'en-US': 'Resume the paused playback',
        'en-GB': 'Resume the paused playback'
      }),

    new SlashCommandBuilder()
      .setName('skip')
      .setDescription('Avança para a faixa seguinte na fila')
      .setDescriptionLocalizations({
        'en-US': 'Skip to the next track in the queue',
        'en-GB': 'Skip to the next track in the queue'
      }),

    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Para a reprodução e limpa a fila de músicas')
      .setDescriptionLocalizations({
        'en-US': 'Stop playback and clear the music queue',
        'en-GB': 'Stop playback and clear the music queue'
      }),

    new SlashCommandBuilder()
      .setName('leave')
      .setDescription('Desliga a Sonora do canal de voz')
      .setDescriptionLocalizations({
        'en-US': 'Disconnect Sonora from the voice channel',
        'en-GB': 'Disconnect Sonora from the voice channel'
      }),

    new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Ajusta o volume de reprodução (0 a 200%)')
      .setDescriptionLocalizations({
        'en-US': 'Adjust the playback volume (0 to 200%)',
        'en-GB': 'Adjust the playback volume (0 to 200%)'
      })
      .addIntegerOption((opt) =>
        opt
          .setName('level')
          .setDescription('Nível de volume entre 0 e 200')
          .setDescriptionLocalizations({
            'en-US': 'Volume level between 0 and 200',
            'en-GB': 'Volume level between 0 and 200'
          })
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(200)
      ),

    new SlashCommandBuilder()
      .setName('nowplaying')
      .setDescription('Apresenta os detalhes e controlos da música em reprodução')
      .setDescriptionLocalizations({
        'en-US': 'Display details and controls for the currently playing track',
        'en-GB': 'Display details and controls for the currently playing track'
      }),

    new SlashCommandBuilder()
      .setName('queue')
      .setDescription('Mostra a fila de reprodução atual')
      .setDescriptionLocalizations({
        'en-US': 'Show the current playback queue',
        'en-GB': 'Show the current playback queue'
      })
      .addIntegerOption((opt) =>
        opt
          .setName('page')
          .setDescription('Número da página da fila')
          .setDescriptionLocalizations({
            'en-US': 'Queue page number',
            'en-GB': 'Queue page number'
          })
          .setRequired(false)
          .setMinValue(1)
      ),

    new SlashCommandBuilder()
      .setName('remove')
      .setDescription('Remove uma música específica da fila pela sua posição')
      .setDescriptionLocalizations({
        'en-US': 'Remove a specific track from the queue by its position',
        'en-GB': 'Remove a specific track from the queue by its position'
      })
      .addIntegerOption((opt) =>
        opt
          .setName('position')
          .setDescription('Posição da faixa na fila (a começar em 1)')
          .setDescriptionLocalizations({
            'en-US': 'Position of the track in the queue (starting at 1)',
            'en-GB': 'Position of the track in the queue (starting at 1)'
          })
          .setRequired(true)
          .setMinValue(1)
      ),

    new SlashCommandBuilder()
      .setName('clear')
      .setDescription('Remove todas as músicas em espera na fila')
      .setDescriptionLocalizations({
        'en-US': 'Remove all upcoming tracks from the queue',
        'en-GB': 'Remove all upcoming tracks from the queue'
      }),

    new SlashCommandBuilder()
      .setName('shuffle')
      .setDescription('Baralha aleatoriamente as músicas na fila de reprodução')
      .setDescriptionLocalizations({
        'en-US': 'Randomly shuffle the tracks in the playback queue',
        'en-GB': 'Randomly shuffle the tracks in the playback queue'
      }),

    new SlashCommandBuilder()
      .setName('loop')
      .setDescription('Define o modo de repetição (desativado, faixa atual ou fila)')
      .setDescriptionLocalizations({
        'en-US': 'Set the repeat mode (off, current track, or entire queue)',
        'en-GB': 'Set the repeat mode (off, current track, or entire queue)'
      })
      .addStringOption((opt) =>
        opt
          .setName('mode')
          .setDescription('Modo de repetição')
          .setDescriptionLocalizations({
            'en-US': 'Repeat mode',
            'en-GB': 'Repeat mode'
          })
          .setRequired(true)
          .addChoices(
            { name: 'Desativado / Off', value: 'off' },
            { name: 'Faixa Atual / Current Track', value: 'track' },
            { name: 'Toda a Fila / Entire Queue', value: 'queue' }
          )
      ),

    new SlashCommandBuilder()
      .setName('lyrics')
      .setDescription('Obtém a letra da música atual ou de uma pesquisa')
      .setDescriptionLocalizations({
        'en-US': 'Fetch lyrics for the current track or a search query',
        'en-GB': 'Fetch lyrics for the current track or a search query'
      })
      .addStringOption((opt) =>
        opt
          .setName('query')
          .setDescription('Nome da música e artista (opcional, usa a faixa atual por omissão)')
          .setDescriptionLocalizations({
            'en-US': 'Track and artist name (optional, defaults to current track)',
            'en-GB': 'Track and artist name (optional, defaults to current track)'
          })
          .setRequired(false)
          .setMaxLength(200)
      ),

    new SlashCommandBuilder()
      .setName('help')
      .setDescription('Mostra a lista de comandos e informações da Sonora')
      .setDescriptionLocalizations({
        'en-US': 'Show Sonora command list and information',
        'en-GB': 'Show Sonora command list and information'
      }),

    new SlashCommandBuilder()
      .setName('language')
      .setDescription('Altera o idioma da Sonora no servidor (Português Europeu ou Inglês)')
      .setDescriptionLocalizations({
        'en-US': 'Change Sonora language for the server (European Portuguese or English)',
        'en-GB': 'Change Sonora language for the server (European Portuguese or English)'
      })
      .addStringOption((opt) =>
        opt
          .setName('locale')
          .setDescription('Idioma pretendido / Target language')
          .setRequired(true)
          .addChoices(
            { name: 'Português (Portugal)', value: 'pt-PT' },
            { name: 'English', value: 'en' }
          )
      )
  ];

  return commands.map((cmd) => cmd.toJSON());
}
