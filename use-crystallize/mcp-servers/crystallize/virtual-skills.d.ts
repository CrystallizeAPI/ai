declare module "virtual:skills" {
    type SkillReference = {
        slug: string;
        content: string;
    };

    type SkillEntry = {
        slug: string;
        name: string;
        description: string;
        content: string;
        references: SkillReference[];
    };

    export const skills: SkillEntry[];
}
