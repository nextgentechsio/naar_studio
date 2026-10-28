import { projectsCollection, usersCollection } from "@/lib/db/mongodb";

// --------------------------------------------------
// CURRENT NAMES
//
// Generations and expenses store the project and user
// name from the time of the run. Reports show today's
// name (after a rename), falling back to the stored one
// for projects or users that no longer exist.
// --------------------------------------------------

export type NameMaps = {
  projects: Map<string, string>;
  users: Map<string, string>;
};

export async function currentNames(
  projectIds: Iterable<string>,
  userIds: Iterable<string>
): Promise<NameMaps> {
  const projectList = [...new Set(projectIds)];
  const userList = [...new Set(userIds)];

  const [projects, users] = await Promise.all([
    projectList.length
      ? (await projectsCollection())
          .find({ _id: { $in: projectList } }, { projection: { name: 1 } })
          .toArray()
      : [],
    userList.length
      ? (await usersCollection())
          .find({ _id: { $in: userList } }, { projection: { name: 1 } })
          .toArray()
      : [],
  ]);

  return {
    projects: new Map(projects.map((doc) => [doc._id, doc.name])),
    users: new Map(users.map((doc) => [doc._id, doc.name])),
  };
}
