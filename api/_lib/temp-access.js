// かつて /pro-max を LINE 認証なしで一時開放していた仕組み (temp-access) は廃止した。
// 配布設計を「公開ページ (認証なし・機能制限) / マガジンページ (LINEログイン必須・全機能)」
// の2経路に分けたため、認証バイパスは不要かつ有害 (ログイン必須と矛盾) になった。
//
// 互換のため authenticateWithTemporaryProMax という名前は残すが、中身は通常の
// LINE トークン検証そのもの (バイパスなし)。呼び出し側の改修を避けるための薄いエイリアス。
const { authenticateFromAuthorizationHeader } = require('./line');

async function authenticateWithTemporaryProMax(req) {
  return authenticateFromAuthorizationHeader(req.headers.authorization);
}

module.exports = { authenticateWithTemporaryProMax };
