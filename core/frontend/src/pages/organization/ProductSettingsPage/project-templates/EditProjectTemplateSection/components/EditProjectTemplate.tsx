import { ProjectType } from "@app/hooks/api/projects/types";
import { TProjectTemplate } from "@app/hooks/api/projectTemplates";

import { ProjectTemplateEnvironmentsForm } from "./ProjectTemplateEnvironmentsForm";
import { ProjectTemplateGroupsSection } from "./ProjectTemplateGroupsSection";
import { ProjectTemplateIdentitiesSection } from "./ProjectTemplateIdentitiesSection";
import { ProjectTemplateRolesSection } from "./ProjectTemplateRolesSection";
import { ProjectTemplateUsersSection } from "./ProjectTemplateUsersSection";

type Props = {
  projectTemplate: TProjectTemplate;
  isVaultixTemplate: boolean;
};

export const EditProjectTemplate = ({ isVaultixTemplate, projectTemplate }: Props) => {
  const { type } = projectTemplate;

  return (
    <div className="flex flex-col gap-6">
      {type === ProjectType.SecretManager && (
        <ProjectTemplateEnvironmentsForm
          isVaultixTemplate={isVaultixTemplate}
          projectTemplate={projectTemplate}
        />
      )}
      <ProjectTemplateRolesSection
        isVaultixTemplate={isVaultixTemplate}
        projectTemplate={projectTemplate}
      />
      {!isVaultixTemplate && (
        <>
          <ProjectTemplateUsersSection projectTemplate={projectTemplate} />
          <ProjectTemplateGroupsSection projectTemplate={projectTemplate} />
          <ProjectTemplateIdentitiesSection projectTemplate={projectTemplate} />
        </>
      )}
    </div>
  );
};
