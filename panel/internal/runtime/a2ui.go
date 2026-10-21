package runtime

// Message is one A2UI v0.9.1 envelope. Payloads are typed maps — "object"
// is not a contract. Unknown component ids are refused at build time.
type Message struct {
	Version   string         `json:"version"`
	Type      string         `json:"type"`
	SurfaceID string         `json:"surfaceId"`
	Payload   map[string]any `json:"payload,omitempty"`
}

type Component struct {
	ID              string         `json:"id"`
	Component       string         `json:"component"`
	TemplateVersion string         `json:"templateVersion"`
	Properties      map[string]any `json:"properties"`
}

func createSurface(surfaceID, catalogID, catalogVer, root string) Message {
	return Message{
		Version: A2UIVersion, Type: "createSurface", SurfaceID: surfaceID,
		Payload: map[string]any{
			"catalogId": catalogID, "catalogVersion": catalogVer, "rootComponentId": root,
		},
	}
}

func updateComponents(surfaceID string, comps []Component) Message {
	out := make([]map[string]any, 0, len(comps))
	for _, c := range comps {
		mustComponent(c.Component)
		out = append(out, map[string]any{
			"id": c.ID, "component": c.Component,
			"templateVersion": c.TemplateVersion, "properties": c.Properties,
		})
	}
	return Message{
		Version: A2UIVersion, Type: "updateComponents", SurfaceID: surfaceID,
		Payload: map[string]any{"components": out},
	}
}

func updateDataModel(surfaceID string, model map[string]any) Message {
	return Message{
		Version: A2UIVersion, Type: "updateDataModel", SurfaceID: surfaceID,
		Payload: map[string]any{"dataModel": model},
	}
}

func knowledgeMessages(surfaceID string, entry Entry) []Message {
	mustComponent(string(entry.Kind))
	return []Message{
		createSurface(surfaceID, KnowledgeCatalogID, KnowledgeCatalogVer, "knowledge-root"),
		updateComponents(surfaceID, []Component{{
			ID: "knowledge-root", Component: string(entry.Kind),
			TemplateVersion: entry.Version,
			Properties:      map[string]any{"entryId": entry.ID, "title": entry.Title},
		}}),
		updateDataModel(surfaceID, map[string]any{
			"entryId": entry.ID, "title": entry.Title, "body": entry.Body,
			"source": "catalog", "presentedAs": "clyffy",
		}),
	}
}

// Refuse reports whether an A2UI component name is outside the catalog.
func Refuse(component string) bool { return !AllowedComponents[component] }
