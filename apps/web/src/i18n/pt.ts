/**
 * pt-PT copy — the primary language (constitution: Locale & time).
 *
 * Copy MUST NOT be hard-coded in components; every visible string comes from here or from `en.ts`.
 * The keys are grouped by screen so a translator can work a screen at a time, and the shape is
 * shared with `en.ts` via `Messages` so a missing key is a compile error rather than a blank label.
 */
export const pt = {
  app: {
    name: 'Padelmigas Bet',
    tagline: 'Vota nas classificações finais dos grupos.',
    nav: {
      tournaments: 'Torneios',
      history: 'Histórico',
      admin: 'Organizador',
    },
    footer: {
      note: 'Votação anónima. Um voto por grupo, por dispositivo.',
    },
  },

  common: {
    loading: 'A carregar…',
    retry: 'Tentar novamente',
    error: 'Algo falhou. Tenta novamente.',
    back: 'Voltar',
    points: 'pontos',
    group: 'Grupo',
    seed: 'Seed',
    close: 'Fechar',
  },

  tournamentList: {
    title: 'Torneios',
    empty: 'Ainda não há torneios publicados.',
    openBadge: 'Votação aberta',
    closedBadge: 'Votação encerrada',
    groupCount: (count: number) => (count === 1 ? '1 grupo' : `${count} grupos`),
    ballotCount: (count: number) => (count === 1 ? '1 voto' : `${count} votos`),
    startsAt: 'Começa',
    loadMore: 'Ver mais',
  },

  tournament: {
    votingOpenUntil: 'Votação aberta até ao início',
    votingClosed: 'Votação encerrada',
    startsAt: 'Início',
    groupsHeading: 'Grupos',
  },

  ballot: {
    heading: 'A tua previsão',
    instructions: 'Escolhe a posição final de cada dupla. Cada posição só pode ser usada uma vez.',
    positionLabel: (position: number) => `${position}.º lugar`,
    choosePosition: 'Escolher posição',
    clearPosition: 'Limpar posição',
    submit: 'Confirmar voto',
    submitting: 'A registar…',
    incomplete: 'Falta atribuir todas as posições.',
    recorded: 'Voto registado.',
    recordedAnnouncement: 'O teu voto foi registado. Os resultados do grupo estão agora visíveis.',
    yourVote: 'O teu voto',
    alreadyVoted: 'Já votaste neste grupo.',
    closed: 'A votação deste grupo já encerrou.',
    rateLimited: 'Demasiadas tentativas. Espera um momento.',
  },

  results: {
    heading: 'Previsão do grupo',
    hidden: 'Vota para ver o que o grupo prevê.',
    noVotes: 'Ainda não há votos neste grupo.',
    ballotCount: (count: number) =>
      count === 1 ? 'com base em 1 voto' : `com base em ${count} votos`,
    predictedPosition: 'Posição prevista',
    meanPosition: 'Posição média',
    positionSharesHeading: 'Distribuição dos votos',
    sharePerPosition: (position: number, share: string) => `${position}.º lugar: ${share}`,
  },

  history: {
    title: 'Histórico',
    empty: 'Ainda não há torneios encerrados.',
    finalPrediction: 'Previsão final do grupo',
  },

  player: {
    appearances: 'Participações',
    noAppearances: 'Este jogador ainda não participou em nenhum torneio.',
    partner: 'Parceiro',
    pointsAtTournament: 'Pontos no torneio',
    currentPoints: 'Pontos atuais',
    club: 'Clube',
    rankingId: 'ID no ranking',
  },

  admin: {
    title: 'Publicar torneio',
    payloadLabel: 'Alinhamento (JSON)',
    payloadHint: 'Cola o alinhamento e pré-visualiza antes de publicar.',
    preview: 'Pré-visualizar',
    previewing: 'A validar…',
    publish: 'Publicar torneio',
    publishing: 'A publicar…',
    published: 'Torneio publicado.',
    resolvedPlayers: 'Jogadores identificados',
    newPlayer: 'novo',
    issuesHeading: 'Problemas a corrigir',
    signIn: 'Entrar',
    password: 'Palavra-passe',
    signInFailed: 'Palavra-passe incorreta.',
    syncRankings: 'Sincronizar ranking',
    syncing: 'A sincronizar…',
    syncReport: (created: number, updated: number) =>
      `${created} jogadores criados, ${updated} atualizados.`,
    syncStale: 'A folha de ranking está inacessível; foi usada a última cópia guardada.',

    // Lineup image import (feature 002)
    uploadHeading: 'Importar de uma imagem',
    uploadHint:
      'Escolhe uma captura de ecrã da tabela do alinhamento (PNG, JPEG ou WebP, até 5 MB). Os nomes e pontos são lidos da imagem; só o nome do torneio e a data ficam por preencher.',
    uploadChoose: 'Escolher imagem',
    uploadReading: 'A ler a imagem…',
    uploadUnavailable:
      'A leitura de imagens não está configurada nesta instalação. Introduz o alinhamento à mão abaixo.',
    uploadTooLargeLocal: (megabytes: number) => `A imagem tem mais de ${megabytes} MB.`,
    uploadWrongType: 'Formato não suportado. Usa PNG, JPEG ou WebP.',
    draftHeading: 'Alinhamento lido da imagem',
    draftName: 'Nome do torneio',
    draftStartsAt: 'Início (hora de Lisboa)',
    draftRequired: 'obrigatório',
    draftPlayer1: 'Jogador 1',
    draftPlayer2: 'Jogador 2',
    draftPoints1: 'PTS J1',
    draftPoints2: 'PTS J2',
    draftTotal: 'Pontos Total',
    draftClub: 'Clube',
    draftAddRow: 'Adicionar dupla',
    draftRemoveRow: 'Remover dupla',
    draftIncomplete: (rows: number) =>
      `Faltam valores em ${rows} ${rows === 1 ? 'dupla' : 'duplas'}. Preenche-os antes de pré-visualizar.`,
    draftDiscardWarning: 'O alinhamento lido ainda não foi publicado. Sair descarta-o.',
    flagMISSING_NAME: 'Nome não lido na imagem.',
    flagMISSING_POINTS: 'Pontos não lidos na imagem.',
    flagMISSING_CLUB: 'Clube não lido na imagem.',
    flagTOTAL_MISMATCH:
      'O total não corresponde à soma dos dois jogadores. Confirma qual está certo.',
    warningNO_ROWS_FOUND: 'Não foi encontrada nenhuma tabela de alinhamento na imagem.',
    warningODD_ROW_COUNT:
      'Foi lido um número ímpar de duplas. Confirma se falta ou sobra alguma linha.',
  },

  errors: {
    NOT_FOUND: 'Não encontrado.',
    UNAUTHORISED: 'Sem autorização.',
    RATE_LIMITED: 'Demasiados pedidos. Espera um momento.',
    MALFORMED_PAYLOAD: 'O pedido não tem o formato esperado.',
    INTERNAL_ERROR: 'Ocorreu um erro inesperado. Tenta novamente.',
    UNRESOLVED_PLAYERS: 'Há nomes que não correspondem a nenhum jogador do ranking.',
    START_NOT_IN_FUTURE: 'A data de início tem de ser no futuro.',
    DUPLICATE_PLAYER: 'Há um jogador repetido no torneio.',
    POINTS_MISMATCH: 'O total de pontos não corresponde à soma dos dois jogadores.',
    INVALID_GROUP_SIZE: 'Um grupo tem de ter entre 3 e 6 duplas.',
    SLUG_TAKEN: 'Já existe um torneio com este endereço.',
    NOT_CONFIRMED: 'A publicação tem de ser confirmada.',
    DUPLICATE_MATCH_KEY: 'Dois jogadores do ranking têm o mesmo nome. Resolve manualmente.',
    INCOMPLETE_BALLOT: 'Falta atribuir todas as posições.',
    DUPLICATE_POSITION: 'Cada posição só pode ser usada uma vez.',
    UNKNOWN_PAIR: 'Há uma dupla que não pertence a este grupo.',
    MISSING_PAIR: 'Falta classificar uma das duplas do grupo.',
    ALREADY_VOTED: 'Já votaste neste grupo.',
    VOTING_CLOSED: 'A votação já encerrou.',
    RESULTS_HIDDEN: 'Vota para ver os resultados.',
    PAYLOAD_TOO_LARGE: 'A imagem é demasiado grande. O limite é 5 MB.',
    EXTRACTION_UNAVAILABLE:
      'A leitura de imagens não está configurada. Introduz o alinhamento à mão.',
    EXTRACTION_FAILED:
      'Não foi possível ler a imagem. Tenta outra imagem ou introduz o alinhamento à mão.',
    NETWORK_ERROR: 'Não foi possível contactar o servidor.',
  },
};

/**
 * Widens string literals to `string` while preserving structure and function signatures.
 *
 * Without this, `Messages` derived from the pt-PT catalogue would demand the exact Portuguese
 * strings, and the English file could not satisfy it. With it, pt-PT remains the schema — every key
 * and every interpolation signature — while the values stay free.
 */
type Widen<T> = T extends string
  ? string
  : T extends (...args: never[]) => unknown
    ? T
    : T extends object
      ? { [K in keyof T]: Widen<T[K]> }
      : T;

export type Messages = Widen<typeof pt>;
