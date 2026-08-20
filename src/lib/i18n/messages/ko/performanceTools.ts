export default {
  directorButton: {
    title: '디렉터 AI 에이전트 (Ctrl+Shift+D)',
    ariaLabel: '디렉터 AI 에이전트 열기',
  },
  director: {
    title: '디렉터',
    live: '라이브',
    liveAria: '디렉터 라이브 출력',
    close: '디렉터 닫기',
    tabs: {
      vj: 'VJ',
      mapping: '매핑',
      generate: '생성',
      support: '지원',
    },
    auto: {
      title: '자동 VJ',
      running: '● 실행 중',
      idle: '대기',
      start: '▶ 시작',
      stop: '자동 VJ 정지',
      beats: '{count}비트',
      beatsLabel: '비주얼 변경 비트 간격',
    },
    mapping: {
      title: '표면 프리셋',
      presets: {
        screen: {
          label: '화면',
          command: '전체 화면 미디어 레이어 하나를 만드세요',
        },
        pyramid: {
          label: '피라미드',
          command: '삼각형 레이어 3개로 3면 피라미드 매핑 레이아웃을 만드세요',
        },
        cube: {
          label: '큐브',
          command: '등각 투시 6면 큐브 매핑 레이아웃과 레이어 6개를 만드세요',
        },
        stage: {
          label: '스테이지',
          command: '스테이지 배경용 직사각형 레이어 3개를 나란히 만드세요',
        },
        grid: {
          label: '격자',
          command: '2×2 격자로 배치한 레이어 4개를 만드세요',
        },
        custom: {
          label: '사용자 지정',
          command: '사용자 지정 매핑 레이아웃을 만들고 필요한 형태를 물어보세요',
        },
      },
    },
    welcome: {
      title: '무엇을 도와드릴까요?',
      hint: 'VJ 덱 구성, 프로젝션 매핑 설정, 셰이더 생성, 전체 공연 환경 제어를 음성이나 텍스트로 도와드립니다.',
    },
    messages: {
      user: '사용자',
      assistant: 'Ghost Arcade AI',
      actionsExecuted: '실행된 작업',
    },
    toolStatus: {
      pending: '대기 중',
      executing: '실행 중',
      success: '완료',
      error: '실패',
      unknown: '상태 알 수 없음',
    },
    quick: {
      vj: {
        buildDeck: { label: '덱 구성', command: '덱을 구성하세요' },
        swapShaders: { label: '셰이더 교체', command: '셰이더를 교체하세요' },
        moreIntense: { label: '더 강렬하게', command: '더 강렬하게' },
        calmDown: { label: '차분하게', command: '차분하게' },
        savePreset: { label: '프리셋 저장', command: '프리셋을 저장하세요' },
        addEffects: { label: '이펙트 추가', command: '이펙트를 추가하세요' },
      },
      mapping: {
        setupCube: { label: '큐브 설정', command: '큐브 매핑을 설정하세요' },
        addLayers: { label: '레이어 6개 추가', command: '레이어 6개를 추가하세요' },
        alignGrid: { label: '격자 정렬', command: '격자를 정렬하세요' },
        addFeather: { label: '페더 추가', command: '페더를 추가하세요' },
        projectionMap: { label: '프로젝션 매핑', command: '프로젝션 매핑을 설정하세요' },
      },
      generate: {
        createShader: { label: '셰이더 생성', command: '셰이더를 생성하세요' },
        darkTechnoVisual: { label: '다크 테크노 비주얼', command: '다크 테크노 비주얼을 만들어 주세요' },
        ambientParticles: { label: '앰비언트 파티클', command: '앰비언트 파티클을 만들어 주세요' },
        generateVideo: { label: '비디오 생성', command: '비디오를 생성하세요' },
      },
      support: {
        reportBug: { label: '버그 신고', command: '버그를 신고하세요' },
        howToMap: { label: '매핑 방법', command: '매핑 방법을 알려주세요' },
        keyboardShortcuts: { label: '키보드 단축키', command: '키보드 단축키를 알려주세요' },
        exportHelp: { label: '내보내기 도움말', command: '내보내기를 도와주세요' },
      },
    },
    input: {
      stopListening: '듣기 중지',
      voiceInput: '음성 입력',
      listening: '듣는 중...',
      placeholder: 'Ghost Arcade에 작업을 지시하세요...',
      ariaLabel: '디렉터 메시지',
      cancel: '응답 취소',
      send: '메시지 전송',
    },
  },
  performancePad: {
    title: '퍼포먼스 패드',
    ariaLabel: '퍼포먼스 XY 패드입니다. 드래그해 바인딩된 파라미터를 제어하세요.',
    status: {
      live: '라이브',
      ready: '준비',
    },
    axis: {
      x: 'X',
      y: 'Y',
      momentum: '관성',
      none: '-- 없음 --',
      xAria: 'X축 파라미터',
      yAria: 'Y축 파라미터',
      momentumAria: '관성 제어',
    },
    triggerAria: '트리거: {label}',
    triggers: {
      flash: '플래시',
      glitch: '글리치',
      color: '색상',
      freeze: '고정',
      drop: '드롭',
      random: '랜덤',
    },
  },
};
