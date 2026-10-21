package runtime

// Source is where an answer actually came from. Presentation is always
// Clyffy. ml is a dormant valve — Decide never returns it.
type Source string

const (
	SourceCatalog  Source = "catalog"
	SourceML       Source = "ml"
	SourceFrontier Source = "frontier"
)

type Reason string

const (
	ReasonCatalogMatch   Reason = "catalog-match"
	ReasonNoCatalogEntry Reason = "no-catalog-entry"
	ReasonOperatorAsked  Reason = "operator-asked-ai"
)

// Decision is the AI boundary record. Same trigger + catalog = same bytes.
type Decision struct {
	SchemaVersion int       `json:"schemaVersion"`
	Trigger       Trigger   `json:"trigger"`
	Serve         Source    `json:"serve"`
	PresentedAs   string    `json:"presentedAs"`
	Reason        Reason    `json:"reason"`
	EntryID       string    `json:"entryId,omitempty"`
	Messages      []Message `json:"messages"`
}

type DecideOpts struct {
	OperatorAskedAI bool
	Entries         []Entry
}

// Decide is pure. Catalog wins. Frontier only with a recorded reason.
// The ml valve is admitted on the type and never returned.
func Decide(surfaceID string, trigger Trigger, opts DecideOpts) Decision {
	if trigger.Kind == "glossary-term" {
		trigger.Term = normalizeTerm(trigger.Term)
	}
	entries := opts.Entries
	if entries == nil {
		entries = Catalog()
	}
	if opts.OperatorAskedAI {
		return Decision{
			SchemaVersion: 1, Trigger: trigger, Serve: SourceFrontier,
			PresentedAs: "clyffy", Reason: ReasonOperatorAsked, Messages: []Message{},
		}
	}
	if match := matchEntry(trigger, entries); match != nil {
		sid := surfaceID
		if sid == "" {
			sid = SurfaceKnowledge
		}
		return Decision{
			SchemaVersion: 1, Trigger: trigger, Serve: SourceCatalog,
			PresentedAs: "clyffy", Reason: ReasonCatalogMatch,
			EntryID: match.ID, Messages: knowledgeMessages(sid, *match),
		}
	}
	return Decision{
		SchemaVersion: 1, Trigger: trigger, Serve: SourceFrontier,
		PresentedAs: "clyffy", Reason: ReasonNoCatalogEntry, Messages: []Message{},
	}
}
