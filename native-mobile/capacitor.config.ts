const config = {
  appId: 'com.ghostarcade.mobile',
  appName: 'Ghost Arcade',
  webDir: '../dist-native-mobile',
  ios: {
    contentInset: 'always',
    limitsNavigationsToAppBoundDomains: false,
    backgroundColor: '#000000',
  },
  android: {
    backgroundColor: '#000000',
    allowMixedContent: true,
  },
};

export default config;
