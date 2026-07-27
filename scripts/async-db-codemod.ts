import * as ts from "../app/node_modules/typescript/lib/typescript.js";
import { readFileSync, writeFileSync } from "node:fs";

const files = process.argv.slice(2);
if (files.length === 0) throw new Error("usage: bun scripts/async-db-codemod.ts <file...>");

const knownAsyncCalls = new Set([
  "activeChildPlayback", "applyGrant", "attachTags", "childStatus", "isChildUser",
  "channelSyncIsDisabled", "importTakeoutHistory", "importTakeoutPlaylists",
  "oidcIdentityExists", "playlistChannelSyncIsDisabled", "recordWatchTick",
  "ensureChannel", "ensureVideo", "getDownload", "mappedObject", "registerChildLockFailure",
  "saveMapping", "setPluginEnabled", "storedVideoCreators", "subtitleList",
  "lockChildByParent", "setSetting", "setUserSetting", "unlockChildProfile",
  "attachPlaylistFollowState", "attachWatchedState", "buildHouseholdInsights",
  "channelRefreshDiagnostics", "getPluginSettings", "instanceHasData", "listPlugins",
  "ownsPlaylist", "setPluginSettings",
]);

interface Edit { start: number; end: number; text: string }

function isPropertyCall(node: ts.CallExpression, owner: string, methods: Set<string>): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  return ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === owner
    && methods.has(node.expression.name.text);
}

function hasAsyncModifier(node: ts.FunctionLikeDeclaration): boolean {
  return Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword));
}

function functionFor(node: ts.Node): ts.FunctionLikeDeclaration | null {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isFunctionLike(current)) return current;
    current = current.parent;
  }
  return null;
}

function asyncInsertion(node: ts.FunctionLikeDeclaration, source: ts.SourceFile): number | null {
  if (hasAsyncModifier(node)) return null;
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) {
    const functionKeyword = node.getChildren(source).find((child) => child.kind === ts.SyntaxKind.FunctionKeyword);
    return functionKeyword?.getStart(source) ?? node.getStart(source);
  }
  if (ts.isArrowFunction(node)) return node.getStart(source);
  return null;
}

for (const filename of files) {
  const text = readFileSync(filename, "utf8");
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statementNames = new Set<string>();
  const transactionNames = new Set<string>();
  const edits: Edit[] = [];
  const asyncFunctions = new Set<number>();

  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      if (isPropertyCall(node.initializer, "db", new Set(["prepare", "query"]))) statementNames.add(node.name.text);
      if (isPropertyCall(node.initializer, "db", new Set(["transaction"]))) transactionNames.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  const markAwait = (node: ts.CallExpression) => {
    if (ts.isAwaitExpression(node.parent)) return;
    edits.push({ start: node.getStart(source), end: node.getStart(source), text: "await " });
    const fn = functionFor(node);
    if (fn) {
      const position = asyncInsertion(fn, source);
      if (position !== null) asyncFunctions.add(position);
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const directExec = isPropertyCall(node, "db", new Set(["exec"]));
      let statementExecution = false;
      if (ts.isPropertyAccessExpression(node.expression) && ["get", "all", "run"].includes(node.expression.name.text)) {
        const receiver = node.expression.expression;
        statementExecution = ts.isIdentifier(receiver) && statementNames.has(receiver.text);
        if (ts.isCallExpression(receiver)) statementExecution ||= isPropertyCall(receiver, "db", new Set(["prepare", "query"]));
      }
      const transactionInvocation = ts.isCallExpression(node.expression)
        && isPropertyCall(node.expression, "db", new Set(["transaction"]));
      const namedTransactionInvocation = ts.isIdentifier(node.expression) && transactionNames.has(node.expression.text);
      const knownAsyncInvocation = ts.isIdentifier(node.expression) && knownAsyncCalls.has(node.expression.text);
      if (directExec || statementExecution || transactionInvocation || namedTransactionInvocation || knownAsyncInvocation) markAwait(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  for (const position of asyncFunctions) edits.push({ start: position, end: position, text: "async " });

  // Only replace the imported database binding and its direct uses. This file
  // intentionally does not rewrite unrelated identifiers or Map.get calls.
  const replaceDb = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === "db") {
      const parent = node.parent;
      if ((ts.isImportSpecifier(parent) && parent.name === node)
        || (ts.isPropertyAccessExpression(parent) && parent.expression === node)) {
        edits.push({ start: node.getStart(source), end: node.getEnd(), text: "database" });
      }
    }
    ts.forEachChild(node, replaceDb);
  };
  replaceDb(source);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text === "./db" && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
      && statement.importClause.namedBindings.elements.some((element) => element.name.text === "db")) {
      edits.push({ start: statement.moduleSpecifier.getStart(source) + 1, end: statement.moduleSpecifier.getEnd() - 1, text: "./database" });
    }
  }

  const unique = new Map<string, Edit>();
  for (const edit of edits) unique.set(`${edit.start}:${edit.end}:${edit.text}`, edit);
  const ordered = [...unique.values()].sort((a, b) => b.start - a.start || b.end - a.end);
  let output = text;
  for (const edit of ordered) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  writeFileSync(filename, output);
}
