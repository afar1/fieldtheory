# worktree-done

Finish the worktree by pushing its branch to the remote, then make sure any remaining uncommitted work in the worktree is committed or explicitly stashed before removing the worktree. After that, check out the same branch in my main working copy so I can continue working and testing there, and stop if any step would risk losing local changes