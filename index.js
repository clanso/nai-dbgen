/**
 * 插件唯一入口：仅 bootstrap，不含业务。
 * 归属：W3-J 装配代理实现。W0 仅冻结签名。
 * manifest hooks.activate / disable 指向本模块导出。
 */

export { activate, dispose } from './src/bootstrap/lifecycle.js';
