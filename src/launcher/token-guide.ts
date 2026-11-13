import { repositoryName } from "../shared/runner-status.ts";

type TokenGuide =
    | { readonly kind: "invalid" }
    | {
          readonly kind: "ready";
          readonly owner: string;
          readonly name: string;
          readonly useUrl: string;
          readonly shareUrl: string;
          readonly collaboratorUrl: string;
      };

function tokenUrl(repository: string, owner: string, purpose: "use" | "share"): string {
    const url = new URL("https://github.com/settings/personal-access-tokens/new");
    url.searchParams.set("name", "shared-morty");
    url.searchParams.set("description", `Use shared-morty with ${repository}. Select only this repository.`);
    url.searchParams.set("target_name", owner);
    url.searchParams.set("expires_in", "90");
    url.searchParams.set("actions", "write");
    url.searchParams.set("issues", "write");
    if (purpose === "share") url.searchParams.set("secrets", "write");
    return url.href;
}

export function tokenGuide(value: string): TokenGuide {
    let repository: string;
    try {
        repository = repositoryName(value);
    } catch {
        return { kind: "invalid" };
    }
    const separator = repository.indexOf("/");
    const owner = repository.slice(0, separator);
    const collaborator = new URL("https://github.com/settings/tokens/new");
    collaborator.searchParams.set("description", `shared-morty: ${repository}`);
    collaborator.searchParams.set("scopes", "repo");
    return {
        kind: "ready",
        owner,
        name: repository.slice(separator + 1),
        useUrl: tokenUrl(repository, owner, "use"),
        shareUrl: tokenUrl(repository, owner, "share"),
        collaboratorUrl: collaborator.href,
    };
}
