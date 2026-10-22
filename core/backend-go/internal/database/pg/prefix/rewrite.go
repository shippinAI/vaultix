package prefix

import (
	"regexp"
	"strings"
)

var schemaQualifiers = map[string]struct{}{
	"public":             {},
	"information_schema": {},
	"pg_catalog":         {},
}

var skipKeywords = map[string]struct{}{
	"if": {}, "not": {}, "exists": {}, "concurrently": {}, "unique": {}, "or": {}, "replace": {}, "local": {},
}

var sqlKeywords = map[string]struct{}{
	"access": {}, "action": {}, "add": {}, "after": {}, "all": {}, "alter": {}, "analyze": {}, "and": {},
	"as": {}, "asc": {}, "before": {}, "begin": {}, "by": {}, "cascade": {}, "case": {}, "cast": {},
	"check": {}, "collate": {}, "column": {}, "comment": {}, "concurrently": {}, "conflict": {},
	"constraint": {}, "create": {}, "cross": {}, "default": {}, "deferrable": {}, "deferred": {},
	"delete": {}, "desc": {}, "distinct": {}, "do": {}, "drop": {}, "each": {}, "else": {}, "end": {},
	"excluded": {}, "exclusive": {}, "execute": {}, "exists": {}, "false": {}, "filter": {}, "first": {},
	"for": {}, "foreign": {}, "from": {}, "full": {}, "function": {}, "grant": {}, "group": {},
	"having": {}, "if": {}, "immediate": {}, "in": {}, "index": {}, "initially": {}, "inner": {},
	"insert": {}, "instead": {}, "into": {}, "is": {}, "join": {}, "key": {}, "language": {},
	"last": {}, "lateral": {}, "left": {}, "limit": {}, "local": {}, "locked": {}, "match": {},
	"materialized": {}, "mode": {}, "natural": {}, "not": {}, "nothing": {}, "nowait": {}, "null": {},
	"nulls": {}, "of": {}, "offset": {}, "on": {}, "only": {}, "or": {}, "order": {}, "outer": {},
	"over": {}, "owner": {}, "partial": {}, "partition": {}, "primary": {}, "procedure": {},
	"recursive": {}, "references": {}, "rename": {}, "replace": {}, "reset": {}, "restrict": {},
	"returning": {}, "returns": {}, "right": {}, "row": {}, "schema": {}, "select": {}, "sequence": {},
	"session": {}, "set": {}, "share": {}, "show": {}, "simple": {}, "skip": {}, "table": {},
	"temp": {}, "temporary": {}, "then": {}, "to": {}, "trigger": {}, "true": {}, "type": {},
	"union": {}, "unique": {}, "unlogged": {}, "update": {}, "using": {}, "values": {}, "verbose": {},
	"view": {}, "when": {}, "where": {}, "with": {},
}

var catalogRe = regexp.MustCompile(`(?i)\b(pg_trigger|pg_indexes|pg_class|pg_constraint|pg_tables|pg_namespace|pg_index|information_schema)\b`)

var catalogNameAssign = regexp.MustCompile(`(?i)(?:indexname|conname|tgname|relname)\s*=\s*$`)

var identRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func (p *Prefixer) rewrite(sql string, rewriteStrings bool) string {
	stringsOn := rewriteStrings && statementRewritesStrings(sql)
	var out strings.Builder
	out.Grow(len(sql) + 16)
	nameList := ""
	expectName := false
	prevKeyword := ""
	codeTail := ""
	note := func(text string) {
		codeTail += text
		if len(codeTail) > 160 {
			codeTail = codeTail[len(codeTail)-160:]
		}
	}
	clearNames := func() {
		nameList = ""
		expectName = false
	}
	onKeyword := func(word string) {
		w := strings.ToLower(word)
		if _, skip := skipKeywords[w]; skip {
			if w == "unique" && nameList == "constraint" {
				clearNames()
			}
			return
		}
		switch {
		case w == "index" && (prevKeyword == "create" || prevKeyword == "drop" || prevKeyword == "alter"):
			nameList = "index"
			expectName = true
		case w == "constraint":
			nameList = "constraint"
			expectName = true
		case w == "trigger" && (prevKeyword == "create" || prevKeyword == "drop"):
			nameList = "trigger"
			expectName = true
		case w == "sequence" && (prevKeyword == "create" || prevKeyword == "drop"):
			nameList = "sequence"
			expectName = true
		case w == "on" || w == "where" || w == "using" || w == "set" || w == "foreign" || w == "primary" || w == "check" || w == "references":
			clearNames()
		}
		prevKeyword = w
	}
	emitIdent := func(original string, quoted bool) {
		next := original
		lower := strings.ToLower(original)
		_, schema := schemaQualifiers[lower]
		if expectName && schema {
			next = original
		} else if expectName {
			next = p.forceObjectName(original)
			expectName = false
		} else if classified, ok := p.classify(original); ok {
			next = classified
		}
		rendered := next
		if quoted {
			rendered = `"` + strings.ReplaceAll(next, `"`, `""`) + `"`
		}
		out.WriteString(rendered)
		note(rendered)
	}

	i := 0
	for i < len(sql) {
		ch := sql[i]
		if ch == '-' && i+1 < len(sql) && sql[i+1] == '-' {
			end := strings.IndexByte(sql[i:], '\n')
			stop := len(sql)
			if end != -1 {
				stop = i + end
			}
			out.WriteString(sql[i:stop])
			i = stop
			continue
		}
		if ch == '/' && i+1 < len(sql) && sql[i+1] == '*' {
			end := strings.Index(sql[i+2:], "*/")
			stop := len(sql)
			if end != -1 {
				stop = i + 2 + end + 2
			}
			out.WriteString(sql[i:stop])
			i = stop
			continue
		}
		if ch == '$' {
			if tag, ok := readDollarTag(sql, i); ok {
				close := strings.Index(sql[i+len(tag):], tag)
				stop := len(sql)
				if close != -1 {
					stop = i + len(tag) + close + len(tag)
				}
				out.WriteString(sql[i:stop])
				i = stop
				continue
			}
		}
		if ch == '\'' {
			content, end := readSingleQuoted(sql, i)
			next := content
			if stringsOn || isRegclassCast(sql, end) {
				next = p.rewriteCatalogString(content, codeTail)
			}
			out.WriteString("'" + strings.ReplaceAll(next, "'", "''") + "'")
			note("''")
			i = end
			continue
		}
		if ch == '"' {
			content, end := readDoubleQuoted(sql, i)
			if strings.EqualFold(content, "public") {
				if next, quoted, nextEnd, ok := peekDotIdent(sql, end); ok && p.shouldDropPublic(next, expectName) {
					emitIdent(next, quoted)
					i = nextEnd
					continue
				}
			}
			emitIdent(content, true)
			i = end
			continue
		}
		if ch == ';' {
			clearNames()
			prevKeyword = ""
			out.WriteByte(ch)
			note(";")
			i++
			continue
		}
		if ch == ',' {
			if nameList == "index" || nameList == "sequence" {
				expectName = true
			}
			out.WriteByte(ch)
			note(",")
			i++
			continue
		}
		if isIdentStart(ch) {
			j := i + 1
			for j < len(sql) && isIdentPart(sql[j]) {
				j++
			}
			word := sql[i:j]
			lower := strings.ToLower(word)
			if lower == "public" {
				if next, quoted, end, ok := peekDotIdent(sql, j); ok && p.shouldDropPublic(next, expectName) {
					emitIdent(next, quoted)
					i = end
					continue
				}
			}
			_, routine := p.routines[lower]
			_, table := p.tables[lower]
			_, keyword := sqlKeywords[lower]
			if routine {
				next := word
				if classified, ok := p.classify(word); ok {
					next = classified
				}
				out.WriteString(next)
				note(next)
			} else if keyword || (isKeywordContext(sql, j) && !table) {
				// A table followed by `(` is an index column list, not a function call.
				onKeyword(word)
				out.WriteString(word)
				note(word)
			} else {
				emitIdent(word, false)
			}
			i = j
			continue
		}
		out.WriteByte(ch)
		note(string(ch))
		i++
	}
	return out.String()
}

func isIdentStart(ch byte) bool {
	return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch == '_'
}

func isIdentPart(ch byte) bool {
	return isIdentStart(ch) || (ch >= '0' && ch <= '9')
}

func isRegclassCast(sql string, pos int) bool {
	k := pos
	for k < len(sql) && isSpace(sql[k]) {
		k++
	}
	const cast = "::regclass"
	if k+len(cast) > len(sql) {
		return false
	}
	return strings.EqualFold(sql[k:k+len(cast)], cast)
}

func peekDotIdent(sql string, pos int) (content string, quoted bool, end int, ok bool) {
	k := pos
	for k < len(sql) && isSpace(sql[k]) {
		k++
	}
	if k >= len(sql) || sql[k] != '.' {
		return "", false, 0, false
	}
	k++
	for k < len(sql) && isSpace(sql[k]) {
		k++
	}
	if k >= len(sql) {
		return "", false, 0, false
	}
	if sql[k] == '"' {
		content, end = readDoubleQuoted(sql, k)
		return content, true, end, true
	}
	if !isIdentStart(sql[k]) {
		return "", false, 0, false
	}
	j := k + 1
	for j < len(sql) && isIdentPart(sql[j]) {
		j++
	}
	return sql[k:j], false, j, true
}

func isSpace(ch byte) bool {
	return ch == ' ' || ch == '\n' || ch == '\t' || ch == '\r'
}

func isKeywordContext(sql string, end int) bool {
	k := end
	for k < len(sql) && (sql[k] == ' ' || sql[k] == '\n' || sql[k] == '\t' || sql[k] == '\r') {
		k++
	}
	return k < len(sql) && sql[k] == '('
}

func readDollarTag(sql string, start int) (string, bool) {
	if start >= len(sql) || sql[start] != '$' {
		return "", false
	}
	j := start + 1
	for j < len(sql) && isIdentPart(sql[j]) {
		j++
	}
	if j >= len(sql) || sql[j] != '$' {
		return "", false
	}
	return sql[start : j+1], true
}

func readSingleQuoted(sql string, start int) (string, int) {
	var content strings.Builder
	i := start + 1
	for i < len(sql) {
		if sql[i] == '\'' && i+1 < len(sql) && sql[i+1] == '\'' {
			content.WriteByte('\'')
			i += 2
			continue
		}
		if sql[i] == '\'' {
			return content.String(), i + 1
		}
		content.WriteByte(sql[i])
		i++
	}
	return content.String(), len(sql)
}

func readDoubleQuoted(sql string, start int) (string, int) {
	var content strings.Builder
	i := start + 1
	for i < len(sql) {
		if sql[i] == '"' && i+1 < len(sql) && sql[i+1] == '"' {
			content.WriteByte('"')
			i += 2
			continue
		}
		if sql[i] == '"' {
			return content.String(), i + 1
		}
		content.WriteByte(sql[i])
		i++
	}
	return content.String(), len(sql)
}

func statementRewritesStrings(sql string) bool {
	var visible strings.Builder
	i := 0
	for i < len(sql) {
		ch := sql[i]
		if ch == '-' && i+1 < len(sql) && sql[i+1] == '-' {
			end := strings.IndexByte(sql[i:], '\n')
			if end == -1 {
				i = len(sql)
			} else {
				i += end
			}
			continue
		}
		if ch == '\'' {
			_, end := readSingleQuoted(sql, i)
			visible.WriteString("''")
			i = end
			continue
		}
		if ch == '"' {
			content, end := readDoubleQuoted(sql, i)
			visible.WriteString(content)
			i = end
			continue
		}
		if ch == '$' {
			if tag, ok := readDollarTag(sql, i); ok {
				close := strings.Index(sql[i+len(tag):], tag)
				if close == -1 {
					i = len(sql)
				} else {
					i = i + len(tag) + close + len(tag)
				}
				continue
			}
		}
		visible.WriteByte(ch)
		i++
	}
	return catalogRe.MatchString(visible.String())
}
