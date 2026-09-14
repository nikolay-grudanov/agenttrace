import { useQuery } from "@tanstack/react-query";
import { getConvoCompressions, type ConvoCompressions } from "../api/convo-compressions";

export function useConvoCompressions(convoId: string | null | undefined) {
  return useQuery<ConvoCompressions>({
    queryKey: ["convo-compressions", convoId],
    queryFn: () => getConvoCompressions(convoId!),
    enabled: !!convoId,
  });
}
