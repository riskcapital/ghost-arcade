const config = {
  appId: 'com.ghostarcade.mobile',
  appName: 'Ghost Arcade',
  webDir: '../dist-native-mobile',
  ios: {
    contentInset: 'never',
    limitsNavigationsToAppBoundDomains: false,
    backgroundColor: '#000000',
  },
  plugins: {
    SystemBars: { style: 'DARK' },
  },
  android: {
    backgroundColor: '#000000',
    allowMixedContent: true,
  },
};

export default config;
