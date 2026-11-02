const {getDefaultConfig}=require('expo/metro-config');
const config=getDefaultConfig(__dirname);
const proxy=require('../backend/scripts/metro-api-proxy.cjs');
const enhance=config.server?.enhanceMiddleware;
config.server={...config.server,enhanceMiddleware:(middleware,server)=>proxy(enhance?enhance(middleware,server):middleware)};
module.exports=config;
