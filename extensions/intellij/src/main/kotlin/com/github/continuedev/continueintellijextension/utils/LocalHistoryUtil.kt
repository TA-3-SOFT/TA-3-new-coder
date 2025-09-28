package com.github.continuedev.continueintellijextension.utils

import com.intellij.history.core.changes.PutLabelChange
import com.intellij.history.core.revisions.ChangeRevision
import com.intellij.history.core.revisions.Revision
import com.intellij.history.integration.ui.models.HistoryDialogModel
import com.intellij.history.integration.ui.models.RevisionItem
import com.intellij.util.containers.ContainerUtil

object LocalHistoryUtil {
/*    @JvmStatic
    fun findRevisionIndexToRevert(dirHistoryModel: HistoryDialogModel, label: PutLabelChange): Int {
        val revs = dirHistoryModel.revisions

        for (i in revs.indices) {
            val rev = revs[i]
            if (isLabelRevision(rev, label)) {
                return i
            }
            if (isChangeWithId(rev.revision, label.id)) {
                return i
            }
        }
        return -1
    }

    @JvmStatic
    fun isLabelRevision(rev: RevisionItem, label: PutLabelChange): Boolean {
        val targetChangeId = label.id
        return ContainerUtil.exists(rev.labels) { revision -> isChangeWithId(revision, targetChangeId) }
    }

    @JvmStatic
    fun isChangeWithId(revision: Revision, targetChangeId: Long): Boolean {
        return revision is ChangeRevision && revision.containsChangeWithId(targetChangeId)
    }*/

    /**
     * 查找离目标时间戳最近且在其之前的版本索引
     * @param dirHistoryModel 历史记录模型
     * @param targetTimestamp 目标时间戳
     * @return 找到的版本索引，如果没有找到返回 -1
     */
    @JvmStatic
    fun findClosestRevisionBeforeTimestamp(dirHistoryModel: HistoryDialogModel, targetTimestamp: Long): Int {
        val revisions = dirHistoryModel.revisions
        var targetRevisionIndex = -1
        var closestTimeDiff = Long.MAX_VALUE

        // 查找离目标时间戳最近且在其之前的版本
        for (i in revisions.indices) {
            val revision = revisions[i]
            val revisionTimestamp = revision.revision.timestamp

            // 只考虑在目标时间戳之前的版本
            if (revisionTimestamp <= targetTimestamp) {
                val timeDiff = targetTimestamp - revisionTimestamp
                if (timeDiff < closestTimeDiff) {
                    closestTimeDiff = timeDiff
                    targetRevisionIndex = i
                }
            }
        }

        return targetRevisionIndex
    }

    /**
     * 获取最适合的历史版本：优先使用指定时间戳之前的版本，如果没有则使用最原始版本
     * @param dirHistoryModel 历史记录模型
     * @param targetTimestamp 目标时间戳
     * @return 历史版本项，如果没有历史记录返回 null
     */
    @JvmStatic
    fun findBestHistoricalRevision(dirHistoryModel: HistoryDialogModel, targetTimestamp: Long): RevisionItem? {
        val revisions = dirHistoryModel.revisions
        if (revisions.isEmpty()) {
            return null
        }

        val targetRevisionIndex = findClosestRevisionBeforeTimestamp(dirHistoryModel, targetTimestamp)

        return if (targetRevisionIndex < 0) {
            // 如果没有找到在时间戳之前的版本，使用最原始的版本（最后一个版本）
            revisions.last()
        } else {
            revisions[targetRevisionIndex-1]
        }
    }
}
