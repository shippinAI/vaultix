import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@app/components/v3";
import { AssistantMemories } from "@app/components/vaultix/AssistantMemories";
import { useGetAssistantPersonas } from "@app/hooks/api/assistant";

export const MemoriesSection = () => {
  const { data } = useGetAssistantPersonas();
  const personas = (data?.personas ?? []).filter((p) => p.role !== "guard");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Memories for everyone</CardTitle>
        <CardDescription>
          Notes every persona reads before answering anyone on this instance, such as naming
          conventions or change rules. Each person also keeps their own from the assistant panel;
          those stay private to them. Memories are notes, never instructions that override the
          standing rules, and never secret values.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AssistantMemories scope="instance" personas={personas} />
      </CardContent>
    </Card>
  );
};
