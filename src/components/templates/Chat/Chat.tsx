'use client';

import { ChatSpace } from '@/organisms/ChatSpace/ChatSpace';
import { ContentLayout } from '@/organisms/ContentLayout/ContentLayout';

export function Chat() {
  return (
    <ContentLayout
      showLeftSidebar={false}
      showRightSidebar={false}
      showLeftMobileButton={false}
      showRightMobileButton={false}
      className="pb-24 lg:pb-12 xl:px-0!"
      classNameWrapperContent="max-w-none"
    >
      <ChatSpace />
    </ContentLayout>
  );
}
