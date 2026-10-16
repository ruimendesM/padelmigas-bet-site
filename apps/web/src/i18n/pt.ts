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
      note: 'Votação anónima. Um voto por grupo, por dispositivo — ou por conta, se entrares.',
    },
  },

  // Optional voter accounts (feature 004)
  account: {
    signIn: 'Entrar',
    register: 'Registar',
    signOut: 'Sair',
    myAccount: 'A minha conta',
    username: 'Nome de utilizador',
    usernameHint: '3 a 30 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.',
    password: 'Palavra-passe',
    passwordHint: 'Pelo menos 8 caracteres.',
    currentPassword: 'Palavra-passe atual',
    newPassword: 'Nova palavra-passe',
    registerTitle: 'Criar conta',
    registerIntro:
      'Com uma conta, o teu voto fica guardado em qualquer dispositivo onde entres. Não é preciso email — e votar continua a não precisar de conta.',
    registerSubmit: 'Criar conta',
    registering: 'A criar…',
    haveAccount: 'Já tens conta?',
    signInTitle: 'Entrar',
    signInIntro:
      'Os votos que fizeste neste dispositivo sem sessão passam para a tua conta. Num grupo em que a conta já votou, fica o voto da conta.',
    signInSubmit: 'Entrar',
    signingIn: 'A entrar…',
    noAccount: 'Ainda não tens conta?',
    temporaryPasswordNotice:
      'Estás a usar uma palavra-passe temporária. Escolhe uma nova para continuar.',
    temporaryPasswordSubmit: 'Guardar e entrar',
    forgotPassword: 'Esqueceste a palavra-passe? Pede ao organizador para a repor.',
    accountTitle: 'A minha conta',
    signedInAs: (username: string) => `Sessão iniciada como ${username}.`,
    changePasswordHeading: 'Alterar palavra-passe',
    changePasswordSubmit: 'Alterar palavra-passe',
    changingPassword: 'A alterar…',
    passwordChanged: 'Palavra-passe alterada. Os outros dispositivos terminaram a sessão.',
    signingOut: 'A sair…',
    voteHint: 'Entra para guardares o teu voto em qualquer dispositivo.',
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
    // Feature 003
    invalidatedBadge: 'Invalidado',
    invalidatedNotice: 'Este alinhamento foi corrigido e substituído.',
    replacedByLink: (name: string) => `Ver o torneio atual: ${name}`,
    resultsWithheld:
      'A previsão deste alinhamento fica disponível quando fechar a votação do torneio que o substituiu.',
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

    // Replacing a tournament (feature 003)
    modeLabel: 'O que queres fazer?',
    modePublish: 'Publicar um torneio novo',
    modeReplace: 'Substituir um torneio com votação aberta',
    replaceTarget: 'Torneio a substituir',
    replaceChoose: 'Escolher torneio',
    replaceNoneOpen: 'Não há torneios com votação aberta.',
    replaceHint:
      'Cola ou importa o alinhamento corrigido completo. Os grupos com a mesma letra e as mesmas duplas mantêm os votos; os restantes recomeçam a votação.',
    replacePreviewHeading: (name: string) => `Substitui: ${name}`,
    keepsVotes: (count: number) => (count === 1 ? 'Mantém 1 voto' : `Mantém ${count} votos`),
    votingRestarts: 'Votação recomeça',
    replace: 'Substituir torneio',
    replacing: 'A substituir…',
    replaced: 'Torneio substituído. O anterior ficou marcado como invalidado.',

    // Voter accounts (feature 004)
    accountsHeading: 'Contas de votantes',
    accountsHint:
      'Procura uma conta pelo nome de utilizador para repor a palavra-passe de quem a esqueceu.',
    accountsSearch: 'Procurar',
    accountsSearching: 'A procurar…',
    accountsQuery: 'Nome de utilizador',
    accountsNone: 'Nenhuma conta encontrada.',
    accountsCreated: 'Criada em',
    accountsPending: 'Palavra-passe temporária por usar',
    accountsReset: 'Repor palavra-passe',
    accountsResetting: 'A repor…',
    accountsResetConfirm: (username: string) =>
      `Repor a palavra-passe de ${username}? A sessão termina em todos os dispositivos.`,
    accountsTemporaryHeading: (username: string) => `Palavra-passe temporária de ${username}`,
    accountsTemporaryHint: (expiresAt: string) =>
      `Mostrada só agora. Envia-a à pessoa: serve uma vez para entrar e escolher uma nova, até ${expiresAt}.`,
    accountsCopy: 'Copiar',
    accountsCopied: 'Copiada',
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
    NOT_REPLACEABLE:
      'Este torneio já não pode ser substituído: a votação fechou ou já foi substituído.',
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
    USERNAME_TAKEN: 'Esse nome de utilizador já existe. Escolhe outro.',
    INVALID_CREDENTIALS: 'Nome de utilizador ou palavra-passe incorretos.',
    PASSWORD_CHANGE_REQUIRED: 'Esta palavra-passe é temporária. Escolhe uma nova para continuar.',
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
