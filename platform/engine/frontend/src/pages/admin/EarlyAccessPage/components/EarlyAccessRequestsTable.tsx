import { useState } from "react";
import {
  faBan,
  faEllipsisV,
  faMagnifyingGlass,
  faPaperPlane,
  faRotateRight,
  faTrash,
  faUserPlus
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { format } from "date-fns";

import { createNotification } from "@app/components/notifications";
import {
  Badge,
  Button,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@app/components/v3";
import {
  getUserTablePreference,
  PreferenceKey,
  setUserTablePreference
} from "@app/helpers/userTablePreferences";
import { useDebounce, usePagination, useResetPageHelper } from "@app/hooks";
import {
  TEarlyAccessRequest,
  TEarlyAccessStatus,
  useDeclineEarlyAccessRequest,
  useDeleteEarlyAccessRequest,
  useDeleteMatchingEarlyAccessRequests,
  useGetEarlyAccessRequests,
  useReissueEarlyAccessInvitation
} from "@app/hooks/api/earlyAccess";
import {
  EmptyState,
  Table,
  TableContainer,
  TableSkeleton,
  TBody,
  Td,
  Th,
  THead,
  Tr
} from "@app/pages/admin/components/AdminTable";
import {
  DeleteActionModal,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Input
} from "@app/pages/admin/components/AdminV3Adapters";

import { InvitationLinkModal, InviteEarlyAccessModal } from "./InviteEarlyAccessModal";

type StatusFilter = TEarlyAccessStatus | "all";

const TABLE_PREFERENCE = "EarlyAccessRequestsTable";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "invited", label: "Invited" },
  { value: "declined", label: "Declined" },
  { value: "all", label: "All requests" }
];

const STATUS_BADGES = {
  pending: { variant: "warning", label: "Pending" },
  invited: { variant: "success", label: "Invited" },
  declined: { variant: "neutral", label: "Declined" }
} as const;

export const EarlyAccessRequestsTable = () => {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 500);
  const [inviting, setInviting] = useState<TEarlyAccessRequest>();
  const [deleting, setDeleting] = useState<TEarlyAccessRequest>();
  const [bulkDelete, setBulkDelete] = useState<{
    status: "pending" | "declined";
    search?: string;
    count: number;
  }>();
  const [reissued, setReissued] = useState<{ email: string; link: string }>();

  const { offset, limit, setPage, perPage, page, setPerPage } = usePagination("", {
    initPerPage: getUserTablePreference(TABLE_PREFERENCE, PreferenceKey.PerPage, 25)
  });

  const { data, isPending, isPlaceholderData } = useGetEarlyAccessRequests({
    limit,
    offset,
    status: statusFilter === "all" ? undefined : statusFilter,
    search: debouncedSearch || undefined
  });
  const { requests = [], totalCount = 0, pendingCount = 0 } = data ?? {};

  useResetPageHelper({ totalCount, offset, setPage });

  const { mutate: declineRequest } = useDeclineEarlyAccessRequest();
  const { mutateAsync: deleteRequest } = useDeleteEarlyAccessRequest();
  const { mutateAsync: deleteMatching } = useDeleteMatchingEarlyAccessRequests();
  const { mutate: reissueInvitation } = useReissueEarlyAccessInvitation();

  // Invited requests record a decision, so they do not go in bulk.
  const bulkStatus =
    statusFilter === "pending" || statusFilter === "declined" ? statusFilter : undefined;
  // Until a new filter has loaded, the rows and count on screen still belong to the previous one.
  const isShowingFilter = !isPlaceholderData && search === debouncedSearch;

  return (
    <div className="rounded-lg border border-border bg-card p-5 text-foreground">
      <div className="mb-4">
        <h2 className="text-xl font-medium text-mineshaft-100">Requests</h2>
        <p className="text-sm text-bunker-300" role="status">
          {pendingCount === 1 ? "1 request waiting" : `${pendingCount} requests waiting`} for
          review.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-64 flex-1">
          <Input
            aria-label="Search early access requests"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            leftIcon={<FontAwesomeIcon icon={faMagnifyingGlass} />}
            placeholder="Search by email, name or organization..."
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter(value as StatusFilter);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44" aria-label="Filter requests by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {bulkStatus && totalCount > 0 && (
          <Button
            variant="ghost"
            type="button"
            isDisabled={!isShowingFilter}
            onClick={() =>
              setBulkDelete({
                status: bulkStatus,
                search: debouncedSearch || undefined,
                count: totalCount
              })
            }
          >
            Delete all {totalCount} matching
          </Button>
        )}
      </div>
      <div className="mt-4">
        <TableContainer>
          <Table>
            <THead>
              <Tr>
                <Th className="w-1/4">Requested by</Th>
                <Th className="w-1/6">Organization</Th>
                <Th>Note</Th>
                <Th className="w-28">Requested</Th>
                <Th className="w-24">Status</Th>
                <Th className="w-5" />
              </Tr>
            </THead>
            <TBody>
              {isPending && <TableSkeleton columns={6} innerKey="early-access-requests" />}
              {!isPending &&
                requests.map((request) => {
                  const badge =
                    STATUS_BADGES[request.status as TEarlyAccessStatus] ?? STATUS_BADGES.pending;
                  return (
                    <Tr key={request.id} className="w-full align-top">
                      <Td className="max-w-0">
                        <p className="truncate" title={request.email}>
                          {request.email}
                        </p>
                        {request.name && (
                          <p className="truncate text-xs text-bunker-300">{request.name}</p>
                        )}
                      </Td>
                      <Td className="max-w-0">
                        <p className="truncate">{request.organization}</p>
                      </Td>
                      <Td>
                        <p className="text-sm break-words whitespace-pre-wrap">{request.useCase}</p>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {format(new Date(request.createdAt), "MMM d, yyyy")}
                      </Td>
                      <Td>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </Td>
                      <Td>
                        <div className="flex justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <IconButton
                                ariaLabel={`Options for ${request.email}`}
                                size="xs"
                                variant="plain"
                              >
                                <FontAwesomeIcon icon={faEllipsisV} />
                              </IconButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent sideOffset={2} align="end">
                              {request.status !== "invited" && (
                                <DropdownMenuItem
                                  icon={<FontAwesomeIcon icon={faPaperPlane} />}
                                  onClick={() => setInviting(request)}
                                >
                                  Invite
                                </DropdownMenuItem>
                              )}
                              {request.status === "invited" && (
                                <DropdownMenuItem
                                  icon={<FontAwesomeIcon icon={faRotateRight} />}
                                  onClick={() =>
                                    reissueInvitation(request.id, {
                                      onSuccess: (invitation) => {
                                        if (invitation.delivery === "link") {
                                          setReissued({
                                            email: invitation.email,
                                            link: invitation.link
                                          });
                                          return;
                                        }
                                        createNotification(
                                          invitation.delivery === "email"
                                            ? {
                                                type: "success",
                                                text: `Invitation emailed to ${request.email}.`
                                              }
                                            : {
                                                type: "error",
                                                text: "The invitation could not be delivered. Try again."
                                              }
                                        );
                                      }
                                    })
                                  }
                                >
                                  Send a new invitation
                                </DropdownMenuItem>
                              )}
                              {request.status === "pending" && (
                                <DropdownMenuItem
                                  icon={<FontAwesomeIcon icon={faBan} />}
                                  onClick={() =>
                                    declineRequest(request.id, {
                                      onSuccess: () =>
                                        createNotification({
                                          type: "success",
                                          text: `Declined ${request.email}. They are not notified.`
                                        })
                                    })
                                  }
                                >
                                  Decline
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                icon={<FontAwesomeIcon icon={faTrash} />}
                                onClick={() => setDeleting(request)}
                              >
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
            </TBody>
          </Table>
          {!isPending && !totalCount && (
            <EmptyState title="No requests to show" icon={faUserPlus} />
          )}
        </TableContainer>
        {!isPending && totalCount > 0 && (
          <Pagination
            count={totalCount}
            page={page}
            perPage={perPage}
            onChangePage={setPage}
            onChangePerPage={(newPerPage) => {
              setPerPage(newPerPage);
              setUserTablePreference(TABLE_PREFERENCE, PreferenceKey.PerPage, newPerPage);
            }}
          />
        )}
      </div>
      <InviteEarlyAccessModal request={inviting} onClose={() => setInviting(undefined)} />
      <InvitationLinkModal invitation={reissued} onClose={() => setReissued(undefined)} />
      <DeleteActionModal
        isOpen={Boolean(bulkDelete)}
        deleteKey="delete"
        title={`Delete all ${bulkDelete?.count} ${bulkDelete?.status} requests${bulkDelete?.search ? ` matching "${bulkDelete.search}"` : ""}?`}
        onChange={(isOpen) => !isOpen && setBulkDelete(undefined)}
        onDeleteApproved={async () => {
          if (!bulkDelete) return;
          const deletedCount = await deleteMatching({
            status: bulkDelete.status,
            search: bulkDelete.search
          });
          createNotification({
            type: "success",
            text: deletedCount === 1 ? "1 request deleted." : `${deletedCount} requests deleted.`
          });
          setBulkDelete(undefined);
        }}
      />
      <DeleteActionModal
        isOpen={Boolean(deleting)}
        deleteKey="delete"
        title={`Delete the request from ${deleting?.email ?? ""}?`}
        onChange={(isOpen) => !isOpen && setDeleting(undefined)}
        onDeleteApproved={async () => {
          if (!deleting) return;
          await deleteRequest(deleting.id);
          createNotification({ type: "success", text: "Request deleted." });
          setDeleting(undefined);
        }}
      />
    </div>
  );
};
