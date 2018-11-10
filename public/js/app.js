(function() {

	function form_handler(query, callback) {
		$(query).submit(function(e) {
			e.preventDefault();

			if ($(query).hasClass('loading')) {
				return;
			}

			var data = $(query).serialize();
			var url = $(query).attr('action');

			$(query).find('.response').html('Please wait...');
			$(query).addClass('loading');

			$.post(url, data, function(rsp) {
				$(query).removeClass('loading');
				if (rsp.ok) {
					$(query).find('.response').html('');
					if (typeof callback == 'function') {
						callback(rsp, e.target);
					}
				} else {
					$(query).find('.response').html(rsp.error);
				}
			})
			.fail(function(rsp) {
				var error = 'Error connecting to server.';
				if ('responseJSON' in rsp && 'error' in rsp.responseJSON) {
					error = rsp.responseJSON.error;
				}
				$(query).find('.response').html(error);
				$(query).removeClass('loading');
			});
		});
	}

	function reply_form_handler(rsp, el) {
		$(el).find('textarea[name="content"]').val('');
		$.get('/api/message/' + rsp.message.id + '?format=html', function(rsp) {

			var $replies = $(el).closest('.replies');
			var $message = $(el).closest('.message');
			var $link = $message.find('> .reply a');

			$replies.find('.message-list').append(rsp);
			var $msg_content = $replies.find('.message-list .message:last-child .message-content');
			format_content($msg_content);

			var $timestamp = $replies.find('.message-list .message:last-child .timestamp a');
			format_timestamp($timestamp);

			$('#members li:eq(0)').before($('#members li.curr-person'));
			$(el).find('.response').html('');

			var count = $replies.find('.message-list .message').length;
			var label = (count == 1) ? ' reply' : ' replies';

			$link.html(count + label);
			$link.addClass('selected');
			$replies.removeClass('no-replies');

		});
	}

	function revisions_handler(e) {

		e.preventDefault();

		var $link = $(e.target);
		var $revisions = $link.closest('.revisions');
		var $message = $link.closest('.message');
		var dates = $link.data('revisions').split(',');

		$message.toggleClass('show-revisions');

		if ($message.hasClass('show-revisions')) {

			$link.html('Done');
			var id = $message.attr('id');
			var options = '';
			var label;

			for (var i = 0; i < dates.length; i++) {
				label = moment(dates[i].trim()).fromNow();
				options += '<option value="' + i + '">' + label + '</option>';
			}

			$message.find('.revision-select').html(
				'Revisions → <select id="revisions-' + id + '">' +
				options +
				'</select>'
			);

			var content = $message.find('.message-content').html();
			$message.find('.revision-content').html('<pre class="message-content">' + content + '</pre>');

			$message.find('.revision-select select').change(function() {
				var rev = $(this).val();
				var url = '/api/message/' + id + '?revision=' + rev;
				$.get(url, function(rsp) {
					$message.find('.revision-content .message-content').html(rsp.message.content);
					format_content($message.find('.revision-content .message-content'));
				});
			});

		} else {
			$link.html('Edited');
			$message.find('.revision-select').html('');
			$message.find('.revision-content').html('');
		}
	}

	function format_timestamp(el) {
		var iso_date = $(el).html().trim();
		var full_timestamp = moment(iso_date).format('MMM D, YYYY, h:mma');
		var relative_time = moment(iso_date).fromNow();
		$(el).attr('data-orig', iso_date);
		$(el).attr('title', full_timestamp);
		$(el).html(relative_time);
	}

	function format_content(el) {
		var content = $(el).html();
		$(el).data('content', content);
		content = content.replace(/https?:\/\/\S+/g, function(url) {
			var text = url;
			return '<a href="' + url + '">' + text + '</a>';
		});
		$(el).html(content);
	}

	function setup_replies(query) {
		$(query).click(function(e) {
			var id = parseInt($(e.target).data('id'));
			if (id) {
				e.preventDefault();
				$link = $(e.target);
				$link.toggleClass('selected');
				if ($link.hasClass('selected')) {

					$('#reply-' + id).html('<div class="replies"><div class="response">Loading replies...</div></div>');

					$.get('/api/replies/' + id, function(rsp) {
						$('#reply-' + id).html(rsp);
						$('#reply-' + id).find('.message-content').each(function(index, el) {
							format_content(el);
						});
						$('#reply-' + id).find('.timestamp a').each(function(index, el) {
							format_timestamp(el);
						});
						form_handler($('#reply-' + id).find('form'), reply_form_handler);
					})
					.fail(function(rsp) {
						if ('responseJSON' in rsp) {
							rsp = rsp.responseJSON;
						}
						if ('error' in rsp) {
							$('#reply-' + id).html('<div class="replies"><div class="response">' + rsp.error + '</div></div>');
						} else {
							$('#reply-' + id).html('<div class="replies"><div class="response">Error loading replies.</div></div>');
						}
					});
				} else {
					$('#reply-' + id).html('');
				}
			}
		});
	}

	$(document).ready(function() {

		form_handler('#login', function(rsp) {
			$('#login .response').html('<div class="next-step">Email sent, please check your inbox.</div>');
			$('#login .controls').addClass('hidden');
		});

		form_handler('#send', function(rsp) {
			$('#send .response').html('Your message has been sent.');
			$('#send textarea[name="content"]').val('');
			$.get('/api/message/' + rsp.message.id + '?format=html', function(rsp) {
				$('#message-list .page:first-child').prepend(rsp);
				format_content($('#message-list .message:first-child .message-content'));
				format_timestamp($('#message-list .message:first-child .timestamp a'));
				$('#members li:eq(0)').before($('#members li.curr-person'));
				setup_replies('#message-list .message:first-child .reply a');
			});
			$('#no-messages').remove();
		});

		var first_update = ($('input[name="name"]').val() == '');
		form_handler('#profile form', function(rsp) {
			var redirect = $('input[name="then"]').val();
			if (redirect) {
				window.location = redirect;
			} else if (first_update) {
				window.location = '/group/';
			} else {
				window.location = '/' + rsp.person.slug;
			}
		});

		form_handler('#new-group', function(rsp) {
			window.location = '/group/' + rsp.group.slug;
		});

		form_handler('#unsubscribed', function(rsp) {
			if (rsp.ok) {
				window.location = window.location;
			}
		});

		form_handler('#settings form', function(rsp) {
			window.location = $('input[name="then"]').val();
		});

		/*$("#send #content").keyup(function(e) {
			while ($(this).outerHeight() < this.scrollHeight + parseFloat($(this).css("borderTopWidth")) + parseFloat($(this).css("borderBottomWidth"))) {
				$(this).height($(this).height() + 1);
			};
		});*/

		if ($('#context').length > 0) {
			$('#intro').addClass('above');
			var context_top = $("#context").offset().top - 32;
			if ($('html, body').scrollTop() < context_top) {
				$('html, body').animate({
					scrollTop: context_top
				}, 500);
			}
		}

		$('.message-content').each(function(index, el) {
			format_content(el);
		});

		$('.timestamp a').each(function(index, el) {
			format_timestamp(el);
		});

		$('#invite-input').focus(function() {
			this.select();
			try {
				if (document.execCommand('copy')) {
					$('#invite-response').html('Copied to your clipboard.');
				}
			} catch(err) {
			}
		});

		$('#join-link').click(function(e) {
			if (! $(document.body).hasClass('logged-in')) {
				e.preventDefault();
				$('html, body').animate({
					scrollTop: 0
				}, 500);
			}
		});

		if ($('#context').hasClass('thread')) {
			$('.page > .message > .reply a').click(function(e) {
				e.preventDefault();
			});
			form_handler($('.reply-form'), reply_form_handler);
		} else {
			setup_replies('.reply a');
		}

		$('#more-messages').click(function(e) {
			e.preventDefault();

			if ($('#more-messages').hasClass('disabled')) {
				return;
			}

			var before_id = $('#more-messages').data('before-id');
			var group = $('#more-messages').data('group');
			$.get('/api/group/' + group + '?before_id=' + before_id, function(rsp) {
				$('#message-list').append(rsp);
				$('#message-list .page:last-child .message-content').each(function(index, el) {
					format_content(el);
				});
				$('#message-list .page:last-child .timestamp a').each(function(index, el) {
					format_timestamp(el);
				});
				setup_replies('#message-list .page:last-child .reply a');

				var $last = $('#message-list .page:last-child .message:last-child');
				$('#more-messages').data('before-id', $last.data('id'));

				var total = parseInt($('#more-messages').data('total-messages'));
				if ($('#message-list .message').length == total) {
					$('#more-messages').addClass('disabled');
					$('#more-messages').html('End of messages');
				}
			});
		});

		if ($('#leave').length > 0) {
			setTimeout(function() {
				window.location = '/';
			}, 5000);
		}

		if ($(document.body).hasClass('logged-in')) {
			$('#message-list').click(function(e) {
				if ($(e.target).hasClass('delete')) {
					if (! confirm('Are you sure you want to delete your message?')) {
						return;
					}
					var id = $(e.target).closest('.message').attr('id');
					id = parseInt(id);
					$.post('/api/delete', {
						id: id
					}, function(rsp) {
						if ($('#context').hasClass('thread') &&
						    $('#context').data('id') == id) {
							window.location = $('#group-link').attr('href');
						} else if (rsp.ok) {
							$('#' + id).remove();
						}
					});
				} else if ($(e.target).hasClass('edit')) {
					var id = $(e.target).closest('.message').attr('id');
					id = parseInt(id);
					var $message = $(e.target).closest('.message');
					$message.addClass('editing');
					$message.find('.message-content').before(
						'<form action="/api/update" method="post">' +
							'<input type="hidden" name="id" value="' + id + '">' +
							'<textarea name="content" rows="3" cols="40"></textarea>' +
							'<input type="submit" value="Update →"> ' +
							'<input type="button" value="Cancel" class="cancel button">' +
							'<div class="response"></div>' +
						'</form>'
					);
					$message.find('textarea').val($message.find('.message-content').data('content'));
					$message.find('.cancel').click(function(e) {
						e.preventDefault();
						$message.find('form').remove();
						$message.removeClass('editing');
					});
					form_handler($message.find('form'), function(rsp) {
						if (rsp.ok) {
							$message.find('.message-content').html(rsp.message.content);
							$message.find('form').remove();
							$message.removeClass('editing');

							var revisions = rsp.message.revision_dates.join(', ');
							$message.find('.revisions').html('<a href="#revisions" class="revisions-link" data-revisions="' + revisions + '">Edited</a>');
							$message.find('.revisions-link').click(revisions_handler);
						}
					});
				}
			});
		}

		$('.revisions-link').click(revisions_handler);

		$('#parent-group').change(function() {
			var option = this.options[this.selectedIndex];
			var slug = $(option).data('slug');
			if (slug) {
				$('#parent-slug').html(slug + '/');
			} else {
				$('#parent-slug').html('');
			}
		});

	});

})();
